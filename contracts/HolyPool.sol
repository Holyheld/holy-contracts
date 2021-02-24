// contracts/HolyPool.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IHolyPool.sol";
import "./interfaces/IHolyHand.sol";
import "./interfaces/IHolyValor.sol";
import "./HolyHand.sol";
import "./HolyWing.sol";

/* HolyPool is a contract that holds user assets
   
   It can have attached strategy (HolyValor) that performs yield generating (investing) activities.
   It is non-custodiary. Any user should be able to withdraw his funds from this contract and, if needed,
   from the attached HolyValor contract without any interference.
   It holds a portion of actual user assets, and part of it is forming a hot reserve (is not invested)
   to provide faster and cheaper withdrawals on demand.
   HolyPool has a base currency (token) set, which is aimed to be USDC at the start of launching.
   Base currency is set during construction (and cannot be changed later to exclude possible malicious
   actions from the managing actors).

   NOTE: this contract doesn't contain function emergencyTransfer as many other HH contracts do, as it is
   actually holding customer funds, and no external access is allowed in any form over them except the user
   himself through defined call pipelines through proxy contract.

   NOTE: HolyPool does not provide any kind of LP/holder/staker token as a result of funds allocation.
   It just adds the appropriate user share amount of the assets in the pool upon deposit and removes
   when user withdraws using local mapping variable and total variable, this would also help to make
   gas cheaper without additional token transfers.

   The only functions that move funds in the pool are
   - depositOnBehalf -- callable only by transfer proxy
   - withdraw -- callable only by transfer proxy
   - borrowToInvest -- provide a portion of funds to be allocated by invest proxy
   - returnInvested -- return invested funds (could be divest or getting received yield) by invest proxy only

   If no conversion is needed, the route of deposit flow
     user USDC -> HolyHand -> HolyPool
   should be kept very minimal to keep gas costs low (same for withdrawal if HolyPool has enough immediate liquidity).

   NOTE: Pool does not perform any exchange, all operations are in baseAsset token
*/
contract HolyPool is AccessControlUpgradeable, IHolyPool {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // role that grants most of financial operations for HolyPool
    bytes32 public constant FINMGMT_ROLE = keccak256("FINMGMT_ROLE");

    uint256 private constant lpPrecision = 1e3;  // treshold to treat quantities (baseAsset, lpTokens) as equal (USDC has 6 decimals only)

    // emergency transfer (timelocked) variables and events
    event EmergencyTransferSet(address indexed token, address indexed destination, uint256 amount);
    event EmergencyTransferExecute(address indexed token, address indexed destination, uint256 amount);
    address private emergencyTransferToken;
    address private emergencyTransferDestination;
    uint256 private emergencyTransferTimestamp;
    uint256 private emergencyTransferAmount;

    // address of ERC20 base asset (expected to be stablecoin)
    address public baseAsset;

    IHolyHand public transferProxy;

    // IHolyValor invest proxies list and their statuses:
    // 0 -- invest proxy is blocked for all operations (equal to be deleted)
    // 1 -- invest proxy is active for all operations
    // 2 -- invest proxy can only place funds back and can not take funds from pool
    //   don't use enum for better upgradeability safety
    IHolyValor[] public investProxies;
    mapping(address => uint256) public investProxiesStatuses;

    // total amount of assets in baseToken (baseToken balance of HolyPool + collateral valuation in baseToken)
    uint256 public totalAssetAmount;

    // total number of pool shares                                            
    uint256 public totalShareAmount; 
    // user balances (this is NOT USDC, but portion in shares)
    mapping(address => uint256) public shares;

    event Deposit(address indexed account, uint256 amount);
    event Withdraw(address indexed account, uint256 amountRequested, uint256 amountActual);

    event FundsInvested(address indexed investProxy, uint256 amount);
    event FundsDivested(address indexed investProxy, uint256 amount);
    event YieldRealized(uint256 amount);

    event ReclaimFunds(address indexed investProxy, uint256 amountRequested, uint256 amountReclaimed);

    bool depositsEnabled;

    uint256 public hotReserveTarget; // target amount of baseAsset tokens held in hot reserve (not invested)

    // for simple yield stats calculations
    uint256 public inceptionTimestamp;    // inception timestamp

    function initialize(address _baseAsset) public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(FINMGMT_ROLE, _msgSender());

        baseAsset = _baseAsset;
        // pool has virtual 1 uint of base asset to avoid 
        // division by zero and reasonable starting share value calculation
        // USDC has 6 decimal points, so USDC pool should have totalAssetAmount 1e6 as a starting point
        totalShareAmount = 1e6;
        totalAssetAmount = 1e6;
        depositsEnabled = true;
        hotReserveTarget = 0;

        inceptionTimestamp = block.timestamp;        
    }

    function getBaseAsset() public override view returns(address) {
        return baseAsset;
    }

    function getDepositBalance(address _beneficiary) public view returns (uint256) {
        return shares[_beneficiary].mul(baseAssetPerShare()).div(1e18);
    }

    function baseAssetPerShare() public view returns (uint256) {
        return totalAssetAmount.mul(1e18).div(totalShareAmount);
    }

    function setTransferProxy(address _transferProxy) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        transferProxy = IHolyHand(_transferProxy);
    }

    function setReserveTarget(uint256 _reserveTarget) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");
        hotReserveTarget = _reserveTarget;
    }

    // HolyValors management functions
    // add new HolyValor
    function addHolyValor(address _address) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        investProxies.push(IHolyValor(_address));
        investProxiesStatuses[_address] = 1;
    }

    // set status for HolyValor, can disable / restrict invest proxy methods
    function setHolyValorStatus(address _address, uint256 _status) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");
        investProxiesStatuses[_address] = _status;
    }

    // Deposit/withdraw functions
    function setDepositsEnabled(bool _enabled) public {
        require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");
        depositsEnabled = _enabled;
    }


    function depositOnBehalf(address _beneficiary, uint256 _amount) public override {
        require(msg.sender == address(transferProxy), "transfer proxy only");
        require(depositsEnabled, "deposits disabled");

        // transfer base asset tokens and calculate shares deposited
        IERC20(baseAsset).safeTransferFrom(msg.sender, address(this), _amount);

        // if not reverted, then we consider amount is transferred and recalculate pool balance
        uint256 assetPerShare = baseAssetPerShare();
        uint256 sharesToDeposit = _amount.mul(1e18).div(assetPerShare);
        totalShareAmount = totalShareAmount.add(sharesToDeposit);
        totalAssetAmount = totalAssetAmount.add(_amount);
        shares[_beneficiary] = shares[_beneficiary].add(sharesToDeposit);

        emit Deposit(_beneficiary, _amount);
    }

    // withdraw funds from pool
    // amount is presented in base asset quantity
    // NOTE: this cannot transfer to arbitrary sender, or funds would be unsafe, only to transferProxy
    //
    // withdraw implementation considerations:
    // - the most important factor is: no external fee if possible;
    // - 2nd most important factor: lowest gas as possible
    //   (smallest valor number used to reclaim funds, keep execution path short for simpler cases);
    // - if external withdraw fee is applied, no other users standings should be affected;
    // - if possible, reserve is restored on HolyPool up to hotReserveTarget
    function withdraw(address _beneficiary, uint256 _amount) public override {
        // TODO: perform funds reclamation if current amount of baseToken is insufficient
        require(msg.sender == address(transferProxy), "transfer proxy only");

        uint256 sharesAvailable = shares[_beneficiary];
        uint256 assetPerShare = baseAssetPerShare();
        uint256 assetsAvailable = sharesAvailable.mul(assetPerShare).div(1e18);
        require(_amount <= assetsAvailable, "requested amount exceeds balance");

        uint256 currentBalance = IERC20(baseAsset).balanceOf(address(this));

        if (currentBalance >= _amount) {
            // best case scenario, HolyPool has assets on reserve (current) balance
            performWithdraw(msg.sender, _beneficiary, _amount, _amount);
            return;
        }

        uint256 amountToReclaim = _amount.sub(currentBalance);
        uint256 reclaimedFunds = retrieveFunds(amountToReclaim);
        if (reclaimedFunds >= amountToReclaim) {
            // good scenario, funds were reclaimed (and probably some reserve amount was restored too)
            performWithdraw(msg.sender, _beneficiary, _amount, _amount);
        } else {
            // not very desireable scenario where funds were returned with fee
            performWithdraw(msg.sender, _beneficiary, _amount, currentBalance.add(reclaimedFunds));
        }
    }

    function performWithdraw(address _addressProxy, address _beneficiary, uint256 _amountRequested, uint256 _amountActual) internal {
        // amount of shares to withdraw to equal _amountActual of baseAsset requested        
        uint256 sharesToWithdraw = _amountRequested.mul(1e18).div(baseAssetPerShare());

        // we checked this regarding base asset (USDC) amount, just in case check for share amount
        require(sharesToWithdraw <= shares[_beneficiary], "requested pool share exceeded");

        // transfer tokens to transfer proxy
        IERC20(baseAsset).safeTransfer(_addressProxy, _amountActual);

        // only perform this after all other withdraw flow complete to recalculate HolyPool state\
        // even if external fees were applied, totalShareAmount/totalAssetAmount calculated
        // with requested withdrawal amount
        shares[_beneficiary] = shares[_beneficiary].sub(sharesToWithdraw);
        totalShareAmount = totalShareAmount.sub(sharesToWithdraw);
        totalAssetAmount = totalAssetAmount.sub(_amountRequested);

        emit Withdraw(_beneficiary, _amountRequested, _amountActual);
    }

    // used to get funds from invest proxy for withdrawal (if current amount to withdraw is insufficient)
    // tries to fulfill reserve
    // logic of funds retrieval:
    // 1. If _amount is larger than is safe to withdraw,
    //    withdraw only requested amount (calculate actully returned as fees may be implied)
    //    (don't imply fees on other users)
    // 2. Otherwise withdraw safe amount up to hotReserveTarget
    //    to keep next withdrawals cheaper
    // _amount parameter is the amount HolyPool shold have in addition to current balance for withdraw
    function retrieveFunds(uint256 _amount) internal returns(uint256) {
        uint256 safeAmountTotal = 0;

        // it is not possible to resize memory arrays, so declare sized one
        uint length = investProxies.length;
        uint256[] memory safeAmounts = new uint[](length);
        uint256[] memory indexes = new uint[](length);

        for (uint256 i; i < length; i++) {
            safeAmounts[i] = investProxies[i].safeReclaimAmount();
            if (safeAmounts[i] >= _amount && investProxiesStatuses[address(investProxies[i])] > 0) {
                // great, this HolyValor can provide funds without external fee
                // see if we can fulfill reserve safely
                // NOTE: _amount can be larger than hotReserveTarget
                uint256 amountToWithdraw = _amount.add(hotReserveTarget);
                if (amountToWithdraw > safeAmounts[i]) {
                  amountToWithdraw = safeAmounts[i]; // cap amountToWithdraw, don't reclaim more than safe amount
                }
                uint256 reclaimed = investProxies[i].reclaimFunds(amountToWithdraw, true);
                require(reclaimed > amountToWithdraw.sub(lpPrecision) && reclaimed.sub(lpPrecision) < amountToWithdraw, "reclaim amount mismatch");
                emit ReclaimFunds(address(investProxies[i]), _amount, amountToWithdraw);
                return amountToWithdraw;
            }
            indexes[i] = i;
            safeAmountTotal = safeAmountTotal.add(safeAmounts[i]);
        }

        // no single HolyValor has enough safe amount to get funds from, check if several have
        // https://medium.com/coinmonks/sorting-in-solidity-without-comparison-4eb47e04ff0d
        // as a reasonable empryric, number of active HolyValors would be less than 10, so use reverse insertion sort
        for (uint256 i = length - 1; i >= 0; i--) {
            uint256 picked = safeAmounts[i];
            uint256 pickedIndex = indexes[i];
            uint256 j = i + 1;
            while ((j < length) && (safeAmounts[j] > picked)) {
                safeAmounts[j - 1] = safeAmounts[j];
                indexes[j - 1] = indexes[j];
                j++;
            }
            safeAmounts[j - 1] = picked;
            indexes[j - 1] = pickedIndex;
            if (i == 0) {
                break; // uint256 won't be negative
            }
        }

        if (safeAmountTotal > _amount) {
            uint256 totalReclaimed = 0;
            // should be able to avoid external withdraw fee (even if use all HolyValors)
            // reclaim funds one by one (from sorted HolyValor list)
            for (uint256 i; i < length; i++) {
                uint256 amountToWithdraw = safeAmounts[indexes[i]];
                if (amountToWithdraw > _amount.sub(totalReclaimed).add(hotReserveTarget)) {
                    amountToWithdraw = _amount.sub(totalReclaimed).add(hotReserveTarget);
                }
                uint256 reclaimed = investProxies[indexes[i]].reclaimFunds(amountToWithdraw, true);
                require(reclaimed > amountToWithdraw.sub(lpPrecision) && reclaimed.sub(lpPrecision) < amountToWithdraw, "reclaim amount mismatch");
                totalReclaimed = totalReclaimed.add(amountToWithdraw);
                emit ReclaimFunds(address(investProxies[indexes[i]]), _amount, amountToWithdraw);
                if (totalReclaimed >= _amount) {
                  break;
                }
            }
            return totalReclaimed;
        }

        // fee would occur, not enough safe amounts available
        uint256 totalReclaimedNoFees = 0; // we don't know what fees are for any investment allocation
                                          // so calculate theoretical quantity we expect without fees
        uint256 totalActualReclaimed = 0;
        // NOTE: we are not replenishing reserve balance when external fees apply
        // reclaim funds one by one (from sorted HolyValor list)
        // to use maximum safe amount and try to withdraw as much as is available in the particular allocation
        for (uint256 i; i < length; i++) {
            uint256 amountToWithdraw = _amount.sub(totalReclaimedNoFees);
            // cap amount if particular HolyValor does not have this amount of funds
            uint256 totalAvailableInValor = investProxies[indexes[i]].totalReclaimAmount();
            if (amountToWithdraw > totalAvailableInValor) {
              amountToWithdraw = totalAvailableInValor;
            }
            uint256 actualReclaimed = investProxies[indexes[i]].reclaimFunds(amountToWithdraw, false);
            totalReclaimedNoFees = totalReclaimedNoFees.add(amountToWithdraw);
            totalActualReclaimed = totalActualReclaimed.add(actualReclaimed);
            emit ReclaimFunds(address(investProxies[indexes[i]]), amountToWithdraw, actualReclaimed);
            if (totalReclaimedNoFees >= _amount) {
                break;
            }
        }
        return totalActualReclaimed;
    }

    // safe amount to withdraw
    // this function is for application to use to confirm withdrawal it exceeds safe amount.
    // takes into consideration this contract balance and invest proxies safe amounts
    // (meaning that no external fees/loss should be applied when withdrawing a certain amount,
    // to get cheapest (in terms of gas) withdraw amount, it's enough to query balanceOf this contract)
    function getSafeWithdrawAmount() public view returns(uint256) {
        uint256 safeAmount = IERC20(baseAsset).balanceOf(address(this));
        uint length = investProxies.length;

        for (uint256 i; i < length; i++) {
            if (investProxiesStatuses[address(investProxies[i])] > 0) {
              safeAmount = safeAmount.add(investProxies[i].safeReclaimAmount());
            }
        }
        return safeAmount;
    }


    // HolyValor invest/divest methods
    function borrowToInvest(uint256 _amount) override public returns(uint256) {
        require(investProxiesStatuses[msg.sender] == 1, "active invest proxy only");

        uint256 borrowableAmount = IERC20(baseAsset).balanceOf(address(this));
        require(borrowableAmount > hotReserveTarget, "not enough funds");

        borrowableAmount = borrowableAmount.sub(hotReserveTarget);
        if (_amount > borrowableAmount) {
          _amount = borrowableAmount;
        }

        IERC20(baseAsset).safeTransfer(msg.sender, _amount);

        emit FundsInvested(msg.sender, _amount);

        return _amount;
    }

    // return funds body from HolyValor (divest), yield should go through yield distributor
    function returnInvested(uint256 _amountCapitalBody) override public {
        require(investProxiesStatuses[msg.sender] > 0, "invest proxy only"); // statuses 1 (active) or 2 (withdraw only) are ok

        IERC20(baseAsset).safeTransferFrom(address(msg.sender), address(this), _amountCapitalBody);

        emit FundsDivested(msg.sender, _amountCapitalBody);
    }

    // Yield realization (intended to be called by HolyRedeemer)
    function harvestYield(uint256 _amountYield) override public {
        // check permissions
        // probably not required (anyone can put yield in pool if they want)

        // transfer _amountYield of baseAsset from caller
        IERC20(baseAsset).safeTransferFrom(msg.sender, address(this), _amountYield);

        // increase share price (indirectly, shares quantity remains same, but baseAsset quantity increases)
        totalAssetAmount = totalAssetAmount.add(_amountYield);

        // emit event
        emit YieldRealized(_amountYield);
    }

    // This is oversimplified, no compounding and averaged across timespan from inception
    // TODO: daily, weekly, monthly, yearly APY
    // at inception pool share equals 1 (1e18) (specified in initializer)
    function getDailyAPY() public view returns(uint256) {
      uint256 secondsFromInception = block.timestamp.sub(inceptionTimestamp);
      
      return baseAssetPerShare().sub(1e18).mul(100) // substract starting share/baseAsset value 1.0 (1e18) and multiply by 100 to get percent value
                 .mul(86400).div(secondsFromInception); // fractional representation of how many days passed
    }


    // emergencyTransferTimelockSet is for safety (if some tokens got stuck)
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
