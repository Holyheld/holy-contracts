// contracts/HolyValorYearnUSDCVaultV3.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IHolyValor.sol";
import "./interfaces/IHolyPool.sol";
import "./interfaces/IYearnVaultUSDC.sol";

///////////////////////////////////////////////////////////////////////////////
// THIS CONTRACT IS WORK IN PROGRESS AND SHOULD NOT BE DEPLOYED
///////////////////////////////////////////////////////////////////////////////

/*
    HolyValor is an investment proxy, that is able to get a portion of funds from a pool
    and allocate it in some yield-generating contract. Also acts as a trigger point for
    yield harvest, updating pool status and balancing pool allocation amount. 
    (TODO: mb the balancing and depositing should be made by the pool itself though)
    
    one important assumption: 
        LP tokens granted by pool DO NOT DECREASE IN UNDERLYING ASSET VALUE

    5000 USD invested with 4000 lp tokens received = 1.25 lp/asset
    1000 USD invested with 750 lp tokens received = 1.33 lp/asset
    in total 6000 USD invested with 4750 lp tokens received = 1.253 lp/asset
    if lp assets don't decrease in price, then we can estimate how much we can withdraw
    to match target in base asset quantity, if amount received is less, than fees were incured

    NOTE: HolyValorYearnUSDCVault is not inherited from some kind of base Valor contract
          to keep all code in one page and have everything implemented explicitly.

    HolyValor has no allowance to get funds from HolyPool directly, only through investInVault method

    V2 -- corrected available withdraw amount calculations
    V3 -- allowance changes (safeApprove, it's not mandatory for USDC vault)
*/
contract HolyValorYearnUSDCVaultV3 is AccessControlUpgradeable, IHolyValor {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    uint256 private constant lpPrecision = 1e3;  // treshold to treat quantities (baseAsset, lpTokens) as equal (USDC has 6 decimals only)

    // role that grants most of financial operations for HolyValor
    bytes32 public constant FINMGMT_ROLE = keccak256("FINMGMT_ROLE");

    // emergency transfer (timelocked) variables and events
    address private emergencyTransferToken;
    address private emergencyTransferDestination;
    uint256 private emergencyTransferTimestamp;
    uint256 private emergencyTransferAmount;
    event EmergencyTransferSet(address indexed token, address indexed destination, uint256 amount);
    event EmergencyTransferExecute(address indexed token, address indexed destination, uint256 amount);

    // common HolyValor properties
    IERC20 public baseAsset;         // USDC
    IHolyPool public holyPool;       // HolyPool address
    address public yieldDistributor; // HolyRedeemer address

    uint256 public amountInvested;   // baseAsset amount that is invested in vault
    uint256 public lpTokensBalance;  // must match lp tokens (vault ERC20) balance of this address

    event FundsInvested(uint256 amountRequested, uint256 amountActual, uint256 lpTokensReceived, uint256 lpTokensBalance);
    event FundsDivested(uint256 lpWithdrawn, uint256 baseAssetExpected, uint256 baseAssetReceived, uint256 lpTokensBalance);
    event HarvestYield(uint256 lpWithdrawn, uint256 baseAssetExpected, uint256 baseAssetReceived, uint256 lpTokensBalance);
    event WithdrawReclaim(uint256 lpWithdrawn, uint256 baseAssetExpected, uint256 baseAssetReceived, uint256 lpTokensBalance);

    // particular HolyValor-related variables
    IYearnVaultUSDC public vaultContract; // yearn USDC vault
    uint256 public inceptionLPPriceUSDC;  // price of share (vault LP token) when Valor was constructed
    uint256 public inceptionTimestamp;    // inception timestamp

    function initialize(address _baseAsset, address _vaultAddress, address _poolAddress) public initializer {
	    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(FINMGMT_ROLE, _msgSender());

        baseAsset = IERC20(_baseAsset); // USDC
        
        vaultContract = IYearnVaultUSDC(_vaultAddress); // yearn yUSDC vault
        inceptionLPPriceUSDC = vaultContract.getPricePerFullShare();
        inceptionTimestamp = block.timestamp;

        connectPool(_poolAddress);

        amountInvested = 0;
        lpTokensBalance = 0;
    }

    // sets pool address and grants allowance to pool
    function connectPool(address _poolAddress) internal {
        holyPool = IHolyPool(_poolAddress);
        baseAsset.approve(_poolAddress, ALLOWANCE_SIZE);
    }

    // callable by admin to set pool for HolyValor
    // should not be called if this contract holds invested funds
    function setPool(address _poolAddress) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        connectPool(_poolAddress);
    }

    // to save gas costs during withdrawals, etc, yield harvested (and it should be only yield)
    // is stored on this contract balance. Yield distributor contract should have permission
    // to get baseAsset tokens from this contract
    function setYieldDistributor(address _distributorAddress) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        yieldDistributor = _distributorAddress;
        // only yield to be redistributed should be present on this contract in baseAsset
        // so no access to lp tokens for the funds invested
        baseAsset.approve(_distributorAddress, ALLOWANCE_SIZE);
    }

    // functions to get/put back funds to HolyPool (and invest/divest to Yearn.Finance USDC v1 Vault)

    // callable only by Finmgmt and perform invest/divest of HolyPool funds
    function investInVault(uint256 _amount, uint256 _minimumAmount) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");
        
        // get available funds from HolyPool and allocate them in vault
        // pool can give less funds than asked to comply with its reserveTarget
        // (even may have not any free funds available)
        uint256 amountBefore = baseAsset.balanceOf(address(this));
        uint256 amountReceived = holyPool.borrowToInvest(_amount);
        uint256 amountAfter = baseAsset.balanceOf(address(this));
        require(amountReceived == amountAfter.sub(amountBefore), "reported/actual amount mismatch");
        require(amountReceived >= _minimumAmount, "minimum amount not available");

        // approve (if required) vault to perform deposit
        if(baseAsset.allowance(address(this), address(vaultContract)) < amountReceived) {
            baseAsset.approve(address(vaultContract), ALLOWANCE_SIZE);
        }

        // NOTE: the amount of lpTokens received for known amount could be used for on-chain APY calculation
        uint256 lpTokensBefore = IERC20(address(vaultContract)).balanceOf(address(this));
        vaultContract.deposit(amountReceived);
        uint256 lpTokensAfter = IERC20(address(vaultContract)).balanceOf(address(this));
        uint256 lpReceived = lpTokensAfter.sub(lpTokensBefore);
        require(lpReceived > 0, "lp tokens not received");

        // increase amounts of lp tokens and baseAsset deposited
        lpTokensBalance = lpTokensBalance.add(lpReceived);
        amountInvested = amountInvested.add(amountReceived);

        emit FundsInvested(_amount, amountReceived, lpReceived, lpTokensBalance);
    }

    // divest funds from vault
    // callable only by Finmgmt to return assets to HolyPool
    // decreases the body of funds, and can realize yield when called
    // if amount is higher than safeDivestAmount, withdraw penalty would be applied to funds received back from Vault
    // amount is base asset quantity (USDC)
    // safeexecution if true, reverts when vault has insufficient base asset balance
    //               if false, vault would get funds from strategy, applying withdrawal fee
    // we don't fallback to available safe amount, because it can be low, this method should be called
    // by automated backend, and better to revert cheaply and reassess decision
    function divestFromVault(uint256 _amount, bool _safeExecution) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");

        uint256 safeWithdrawAmountUSDC = IERC20(vaultContract.token()).balanceOf(address(vaultContract));
        if (_safeExecution && _amount > safeWithdrawAmountUSDC) {
            revert("insufficient safe withdraw balance");
        }

        // this is 1e18 fixed-point number
        uint256 lpPriceUSDC = vaultContract.getPricePerFullShare();

        // calculate amount of lpTokens to withdraw
        uint256 lpTokensToWithdraw = _amount.mul(1e18).div(lpPriceUSDC);
        
        if (lpTokensToWithdraw > IERC20(address(vaultContract)).balanceOf(address(this))) {
            revert("insufficient lp tokens");
        }

        // provide allowance for vault to burn lp tokens
        if (IERC20(address(vaultContract)).allowance(address(this), address(vaultContract)) < lpTokensToWithdraw) {
            IERC20(address(vaultContract)).approve(address(vaultContract), ALLOWANCE_SIZE);
        }

        uint256 baseAssetTokensBefore = baseAsset.balanceOf(address(this));
        vaultContract.withdraw(lpTokensToWithdraw);
        uint256 baseAssetTokensAfter = baseAsset.balanceOf(address(this));
        uint256 USDCReceived = baseAssetTokensAfter.sub(baseAssetTokensBefore);
        // update number of lpTokens
        lpTokensBalance = lpTokensBalance.sub(lpTokensToWithdraw);

        // we are withdrawing the invested funds body portion (divesting)
        // so the calculated amount of lpTokens should match the target amount of USDC
        //   USDCReceived matches amount (could be tiny difference in least significant digits)
        //   negative outcome (unexpected) -- withdraw amount less than calculated
        //   (should occur only when safeExecution == false for emergency withdrawals)

        // transfer USDC received back to pool and decrease amountInvested
        holyPool.returnInvested(USDCReceived);

        // even if vault returnes less, decrease on the requested withdraw amount
        amountInvested = amountInvested.sub(_amount);

        emit FundsDivested(lpTokensToWithdraw, _amount, USDCReceived, lpTokensBalance);
    }

    // reclaimFunds method
    // callable only by HolyPool (if additional funds needed during withdrawal request)
    // if amount retrieved is less than expected then withdraw penalty had occured.
    // there are 2 possible outcomes:
    // - amount of baseAsset received is exactly matching requested amount (excluding some lesser digits due to arithmetics);
    // - amount of baseAsset received is less than requested, withdraw penatly was applied by Vault;
    function reclaimFunds(uint256 _amount, bool _safeExecution) external override returns(uint256) {
        require(msg.sender == address(holyPool), "Pool only");

        uint256 safeWithdrawAmountUSDC = IERC20(vaultContract.token()).balanceOf(address(vaultContract));
        if (_safeExecution && _amount > safeWithdrawAmountUSDC) {
            revert("insufficient safe withdraw balance");
        }

        // this is 1e18 fixed-point number
        uint256 lpPriceUSDC = vaultContract.getPricePerFullShare();

        // calculate amount of lpTokens to withdraw
        uint256 lpTokensToWithdraw = _amount.mul(1e18).div(lpPriceUSDC);
        
        // provide allowance for vault to burn lp tokens
        if (IERC20(address(vaultContract)).allowance(address(this), address(vaultContract)) < lpTokensToWithdraw) {
            IERC20(address(vaultContract)).approve(address(vaultContract), ALLOWANCE_SIZE);
        }

        uint256 baseAssetTokensBefore = baseAsset.balanceOf(address(this));
        vaultContract.withdraw(lpTokensToWithdraw);
        uint256 baseAssetTokensAfter = baseAsset.balanceOf(address(this));
        uint256 USDCReceived = baseAssetTokensAfter.sub(baseAssetTokensBefore);
        // update number of lpTokens
        lpTokensBalance = lpTokensBalance.sub(lpTokensToWithdraw);

        // we are withdrawing the invested funds body portion for a withdrawal
        // so the calculated amount of lpTokens should match the target amount of USDC to receive
        // therefore, no yield is realized or other addresses balances affected in pool
        // two outcomes:
        //   USDCReceived matches amount (could be tiny difference in least significant digits)
        //   negative outcome (unexpected) -- withdraw amount less than calculated

        // transfer USDC received back to pool and decrease amountInvested
        baseAsset.transfer(address(holyPool), USDCReceived);

        // even if vault returnes less, decrease on the requested withdraw amount
        amountInvested = amountInvested.sub(_amount);

        emit WithdrawReclaim(lpTokensToWithdraw, _amount, USDCReceived, lpTokensBalance);

        return USDCReceived;
    }

    // harvest yield method
    // the goal of this method is to get baseAsset that:
    // - could be safely divested from Vault without applying fees;
    // - the resulting balance of current lpTokens price could not be below amountInvested;
    // - yield would reside on this Valor balance to be distributed by HolyRedeemer
    //   to increase user balances on pool (and fulfill pool reserve), fulfill treasury and fund operations
    //   (yield asset claim strategy is not in the scope of this contract)
    // thus should not decreate invested funds body (amountInvested quantity of baseAsset)
    // NOTE: this currently is able to claim only available funds without vault strategy fee from vault address
    //       otherwise recalculation would be needed taking fee into consideration
    function harvestYield(uint256 minExpectedAmount, uint256 maxAmount) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");

        // this is 1e18 fixed-point number
        uint256 lpPriceUSDC = vaultContract.getPricePerFullShare();

        // calculate safe amount of USDC that could be withdrawn
        uint256 safeWithdrawAmountUSDC = IERC20(vaultContract.token()).balanceOf(address(vaultContract));
        require(minExpectedAmount <= safeWithdrawAmountUSDC, "min amount larger than safe amount");

        // calculate amount that won't decrease invested baseAsset amount
        // if calculation underflows, this is bad (vault shows negative return)
        uint256 accruedYieldUSDC = lpTokensBalance.mul(lpPriceUSDC).div(1e18).sub(amountInvested);
        require(accruedYieldUSDC >= minExpectedAmount, "yield to harvest less than min");
        
        // start with safe amount to reclaim
        uint256 harvestAmountUSDC = safeWithdrawAmountUSDC;

        // we take only accrued yield to distribute it with HolyRedeemer later, cap to accruedYield amount
        if (harvestAmountUSDC > accruedYieldUSDC) {
            harvestAmountUSDC = accruedYieldUSDC;
        }

        // cap to maxAmount if applicable
        if (harvestAmountUSDC > maxAmount) {
            harvestAmountUSDC = maxAmount;
        }

        // calculate amount of lpTokens to withdraw
        uint256 lpTokensToWithdraw = harvestAmountUSDC.mul(1e18).div(lpPriceUSDC);

        // provide allowance for vault to burn lp tokens
        if (IERC20(address(vaultContract)).allowance(address(this), address(vaultContract)) < lpTokensToWithdraw) {
            IERC20(address(vaultContract)).approve(address(vaultContract), ALLOWANCE_SIZE);
        }

        uint256 baseAssetTokensBefore = baseAsset.balanceOf(address(this));
        vaultContract.withdraw(lpTokensToWithdraw);
        uint256 baseAssetTokensAfter = baseAsset.balanceOf(address(this));
        uint256 USDCReceived = baseAssetTokensAfter.sub(baseAssetTokensBefore);
        // update number of lpTokens
        lpTokensBalance = lpTokensBalance.sub(lpTokensToWithdraw);

        // the received base asset USDC tokens reside on this contract until yield distributor picks them

        emit HarvestYield(lpTokensToWithdraw, harvestAmountUSDC, USDCReceived, lpTokensBalance);
        // good outcome -- harvestAmountUSDC matches USDCReceived (could be tiny difference in least significant digits)
        // negative outcome (unexpected) -- withdraw amount less than calculated
    }

    // get safe amount of funds in base asset (USDC) that is possible to reclaim from this HolyValor without fee/penalty
    function safeReclaimAmount() external override view returns(uint256) {
        // as we (and vault) recalculate shares/base asset amounts with high, but not unlimited precision, we
        // pessimize safe amount by a tiny margin (this does not affect accounts, it's to be sure
        // vault would be able to provide base asset to lp shares quantity without external fee)
        uint256 safeAmount = IERC20(vaultContract.token()).balanceOf(address(vaultContract));
        if (safeAmount >= lpPrecision) {
            return safeAmount.sub(lpPrecision);
        }
        return 0; // safe amount is so tiny, we assume 0
    }

    function totalReclaimAmount() external override view returns(uint256) {
        return amountInvested;
    }

    // get current net asset value measured in baseAsset of HolyValor (USDC)
    // NOTE: this includes unharvested yield and should not be used for reclaim calculations
    function getAssetsUnderManagement() public view returns(uint256) {
        // this is 1e18 fixed-point number
        uint256 lpPriceUSDC = vaultContract.getPricePerFullShare();

        return lpTokensBalance.mul(lpPriceUSDC).div(1e18);
    }

    // simple APY getter (share price increase since inception of this contract)
    function getAPYInception() public view returns(uint256) {
        // this is 1e18 fixed-point number
        uint256 lpPriceUSDC = vaultContract.getPricePerFullShare();

        return lpPriceUSDC.mul(1e18).div(inceptionLPPriceUSDC);
    }

    // emergencyTransferTimelockSet is for safety (if some tokens got stuck)
    // timelock applied because this contract holds lp tokens for invested funds
    // in the future it could be removed, to restrict access to user funds
    // this is timelocked as contract can have user funds
	function emergencyTransferTimelockSet(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        emergencyTransferTimestamp = block.timestamp;
        emergencyTransferToken = _token;
        emergencyTransferDestination = _destination;
        emergencyTransferAmount = _amount;

        emit EmergencyTransferSet(_token, _destination, _amount);
	}

	function emergencyTransferExecute() public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        require(block.timestamp > emergencyTransferTimestamp + 24 * 3600, "timelock too early");
        require(block.timestamp < emergencyTransferTimestamp + 72 * 3600, "timelock too late");

        IERC20(emergencyTransferToken).safeTransfer(emergencyTransferDestination, emergencyTransferAmount);

        emit EmergencyTransferExecute(emergencyTransferToken, emergencyTransferDestination, emergencyTransferAmount);
        // clear emergency transfer timelock data
        emergencyTransferTimestamp = 0;
        emergencyTransferToken = address(0);
        emergencyTransferDestination = address(0);
        emergencyTransferAmount = 0;
    }
}