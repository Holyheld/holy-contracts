// contracts/HolyHandV3.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

///////////////////////////////////////////////////////////////////////////
//     __/|      
//  __////  /|   This smart contract is part of Mover infrastructure
// |// //_///    https://viamover.com
//    |_/ //     support@viamover.com
//       |/
///////////////////////////////////////////////////////////////////////////

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IHolyPoolV2.sol";
import "./interfaces/IHolyWing.sol";
import "./interfaces/IHolyWingV2.sol";
import "./interfaces/IHolyRedeemer.sol";
import "./interfaces/ISmartTreasury.sol";
import "./interfaces/IBurnable.sol";
import "./utils/SafeAllowanceReset.sol";


/*
    HolyHand is a transfer proxy contract for ERC20 and ETH transfers through Holyheld infrastructure (deposit/withdraw to HolyPool, swaps, etc.)
    - extract fees;
    - call token conversion if needed;
    - deposit/withdraw tokens into HolyPool;
    - non-custodial, not holding any funds;
    - fees are accumulated on this contract's balance (if fees enabled);

    This contract is a single address that user grants allowance to on any ERC20 token for interacting with HH services.
    This contract could be upgraded in the future to provide subsidized transactions using bonuses from treasury.

    TODO: if token supports permit, provide ability to execute without separate approval call

    V2 version additions:
    - direct deposits to pool (if no fees or conversions);
    - when swapping tokens direct return converted asset to sender (if no fees);
    - ETH support (non-wrapped ETH conversion for deposits and swaps);
    - emergencyTransfer can reclaim ETH

    V3 version additions:
    - support for subsidized transaction execution;
*/
contract HolyHandV3 is AccessControlUpgradeable, SafeAllowanceReset {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    uint256 private constant ALLOWANCE_SIZE =
        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    // token address for non-wrapped eth
    address private constant ETH_TOKEN_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // if greater than zero, this is a fractional amount (1e18 = 1.0) fee applied to all deposits
    uint256 public depositFee;
    // if greater than zero, this is a fractional amount (1e18 = 1.0) fee applied to exchange operations with HolyWing proxy
    uint256 public exchangeFee;
    // if greater than zero, this is a fractional amount (1e18 = 1.0) fee applied to withdraw operations
    uint256 public withdrawFee;

    // HolyWing exchange proxy/middleware
    IHolyWing private exchangeProxyContract;

    // HolyRedeemer yield distributor
    // NOTE: to keep overhead for users minimal, fees are not transferred
    // immediately, but left on this contract balance, yieldDistributor can reclaim them
    address private yieldDistributorAddress;

    event TokenSwap(
        address indexed tokenFrom,
        address indexed tokenTo,
        address sender,
        uint256 amountFrom,
        uint256 expectedMinimumReceived,
        uint256 amountReceived
    );

    event FeeChanged(string indexed name, uint256 value);

    event EmergencyTransfer(
        address indexed token,
        address indexed destination,
        uint256 amount
    );

    function initialize() public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        depositFee = 0;
        exchangeFee = 0;
        withdrawFee = 0;
    }

    function setExchangeProxy(address _exchangeProxyContract) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        exchangeProxyContract = IHolyWing(_exchangeProxyContract);
    }

    function setYieldDistributor(
        address _tokenAddress,
        address _distributorAddress
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        yieldDistributorAddress = _distributorAddress;
        // only yield to be redistributed should be present on this contract in baseAsset (or other tokens if swap fees)
        // so no access to lp tokens for the funds invested
        resetAllowanceIfNeeded(
            IERC20(_tokenAddress),
            _distributorAddress,
            ALLOWANCE_SIZE
        );
    }

    // if the pool baseToken matches the token deposited, then no conversion is performed
    // and _expectedMininmumReceived/convertData should be zero/empty
    function depositToPool(
        address _poolAddress,
        address _token,
        uint256 _amount,
        uint256 _expectedMinimumReceived,
        bytes memory _convertData
    ) public payable {
        depositToPoolOnBehalf(msg.sender, _poolAddress, _token, _amount, _expectedMinimumReceived, _convertData);
    }

    function depositToPoolOnBehalf(
        address _beneficiary,
        address _poolAddress,
        address _token,
        uint256 _amount,
        uint256 _expectedMinimumReceived,
        bytes memory _convertData
    ) internal {
        IHolyPoolV2 holyPool = IHolyPoolV2(_poolAddress);
        IERC20 poolToken = IERC20(holyPool.getBaseAsset());

        if (address(poolToken) == _token) {
            // no conversion is needed, allowance and balance checks performed in ERC20 token
            // and not here to not waste any gas fees

            if (depositFee == 0) {
                // use depositOnBehalfDirect function only for this flow to save gas as much as possible
                // (we have approval for this contract, so it can transfer funds to pool directly if
                // deposit fees are zero (otherwise we go with standard processing flow)

                // transfer directly to pool
                IERC20(_token).safeTransferFrom(
                    _beneficiary,
                    _poolAddress,
                    _amount
                );

                // call pool function to process deposit (without transfer)
                holyPool.depositOnBehalfDirect(_beneficiary, _amount);
                return;
            }

            IERC20(_token).safeTransferFrom(_beneficiary, address(this), _amount);

            // HolyPool must have sufficient allowance (one-time for pool/token pair)
            resetAllowanceIfNeeded(poolToken, _poolAddress, _amount);

            // process deposit fees and deposit remainder
            uint256 feeAmount = _amount.mul(depositFee).div(1e18);
            holyPool.depositOnBehalf(_beneficiary, _amount.sub(feeAmount));
            return;
        }

        // conversion is required, perform swap through exchangeProxy (HolyWing)
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransferFrom(
                _beneficiary,
                address(exchangeProxyContract),
                _amount
            );
        }

        if (depositFee > 0) {
            // process exchange/deposit fees and route through HolyHand
            uint256 amountReceived =
                IHolyWingV2(address(exchangeProxyContract)).executeSwapDirect{value: msg.value}(
                    address(this),
                    _token,
                    address(poolToken),
                    _amount,
                    exchangeFee,
                    _convertData
                );
            require(
                amountReceived >= _expectedMinimumReceived,
                "minimum swap amount not met"
            );
            uint256 feeAmount = amountReceived.mul(depositFee).div(1e18);
            amountReceived = amountReceived.sub(feeAmount);

            // HolyPool must have sufficient allowance (one-time for pool/token pair)
            resetAllowanceIfNeeded(poolToken, _poolAddress, _amount);

            // perform actual deposit call
            holyPool.depositOnBehalf(_beneficiary, amountReceived);
        } else {
            // swap directly to HolyPool address and execute direct deposit call
            uint256 amountReceived =
                IHolyWingV2(address(exchangeProxyContract)).executeSwapDirect{value: msg.value}(
                    _poolAddress,
                    _token,
                    address(poolToken),
                    _amount,
                    exchangeFee,
                    _convertData
                );
            require(
                amountReceived >= _expectedMinimumReceived,
                "minimum swap amount not met"
            );
            holyPool.depositOnBehalfDirect(_beneficiary, amountReceived);
        }
    }

    function withdrawFromPool(address _poolAddress, uint256 _amount) public {
        withdrawFromPoolOnBehalf(msg.sender, _poolAddress, _amount);
    }

    function withdrawFromPoolOnBehalf(address _beneficiary, address _poolAddress, uint256 _amount) internal {
        IHolyPoolV2 holyPool = IHolyPoolV2(_poolAddress);
        IERC20 poolToken = IERC20(holyPool.getBaseAsset());
        uint256 amountBefore = poolToken.balanceOf(address(this));
        holyPool.withdraw(_beneficiary, _amount);
        uint256 withdrawnAmount =
            poolToken.balanceOf(address(this)).sub(amountBefore);

        // if amount is less than expected, transfer anyway what was actually received
        if (withdrawFee > 0) {
            // process withdraw fees
            uint256 feeAmount = withdrawnAmount.mul(withdrawFee).div(1e18);
            poolToken.safeTransfer(_beneficiary, withdrawnAmount.sub(feeAmount));
        } else {
            poolToken.safeTransfer(_beneficiary, withdrawnAmount);
        }
    }

    function setDepositFee(uint256 _depositFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        depositFee = _depositFee;
        emit FeeChanged("deposit", _depositFee);
    }

    function setExchangeFee(uint256 _exchangeFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        exchangeFee = _exchangeFee;
        emit FeeChanged("exchange", _exchangeFee);
    }

    function setWithdrawFee(uint256 _withdrawFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        withdrawFee = _withdrawFee;
        emit FeeChanged("withdraw", _withdrawFee);
    }

    function setTransferFee(uint256 _transferFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        transferFee = _transferFee;
        emit FeeChanged("transfer", _transferFee);
    }

    // token swap function (could be with fees but also can be subsidized later)
    // perform conversion through exhcnageProxy (HolyWing)
        function executeSwap(
        address _tokenFrom,
        address _tokenTo,
        uint256 _amountFrom,
        uint256 _expectedMinimumReceived,
        bytes memory _convertData
    ) public payable {
        executeSwapOnBehalf(msg.sender, _tokenFrom, _tokenTo, _amountFrom, _expectedMinimumReceived, _convertData);
    }

    function executeSwapOnBehalf(
        address _beneficiary,
        address _tokenFrom,
        address _tokenTo,
        uint256 _amountFrom,
        uint256 _expectedMinimumReceived,
        bytes memory _convertData
    ) internal {
        require(_tokenFrom != _tokenTo, "same tokens provided");

        // swap with direct transfer to HolyWing and HolyWing would transfer swapped token (or ETH) back to msg.sender
        if (_tokenFrom != ETH_TOKEN_ADDRESS) {
            IERC20(_tokenFrom).safeTransferFrom(
                _beneficiary,
                address(exchangeProxyContract),
                _amountFrom
            );
        }
        uint256 amountReceived =
            IHolyWingV2(address(exchangeProxyContract)).executeSwapDirect{value: msg.value}(
                _beneficiary,
                _tokenFrom,
                _tokenTo,
                _amountFrom,
                exchangeFee,
                _convertData
            );
        require(
            amountReceived >= _expectedMinimumReceived,
            "minimum swap amount not met"
        );
    }

    // payable fallback to receive ETH when swapping to raw ETH
    receive() external payable {}

    // this function is similar to emergencyTransfer, but relates to yield distribution
    // fees are not transferred immediately to save gas costs for user operations
    // so they accumulate on this contract address and can be claimed by HolyRedeemer
    // when appropriate. Anyway, no user funds should appear on this contract, it
    // only performs transfers, so such function has great power, but should be safe
    // It does not include approval, so may be used by HolyRedeemer to get fees from swaps
    // in different small token amounts
    function claimFees(address _token, uint256 _amount) public {
        require(
            msg.sender == yieldDistributorAddress,
            "yield distributor only"
        );
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransfer(msg.sender, _amount);
        } else {
            payable(msg.sender).sendValue(_amount);
        }
    }

    // all contracts that do not hold funds have this emergency function if someone occasionally
    // transfers ERC20 tokens directly to this contract
    // callable only by owner
    function emergencyTransfer(
        address _token,
        address _destination,
        uint256 _amount
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransfer(_destination, _amount);
        } else {
            payable(_destination).sendValue(_amount);
        }
        emit EmergencyTransfer(_token, _destination, _amount);
    }

    ///////////////////////////////////////////////////////////////////////////
    // V3 SMART TREASURY AND SUBSIDIZED TRANSACTIONS
    ///////////////////////////////////////////////////////////////////////////
    // these should be callable only by trusted backend wallet
    // so that only signed by account and validated actions get executed and proper bonus amount
    // if spending bonus does not revert, account has enough bonus tokens
    // this contract must have EXECUTOR_ROLE set in Smart Treasury contract to call this

    bytes32 public constant TRUSTED_EXECUTION_ROLE = keccak256("TRUSTED_EXECUTION");  // trusted execution wallets

    address smartTreasury;
    address tokenMoveAddress;
    address tokenMoveEthLPAddress;

    // if greater than zero, this is a fractional amount (1e18 = 1.0) fee applied to transfer operations (that could also be subsidized)
    uint256 public transferFee;

    // connect to Smart Treasury contract
    function setSmartTreasury(address _smartTreasury) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        smartTreasury = _smartTreasury;
    }

    function setTreasuryTokens(address _tokenMoveAddress, address _tokenMoveEthLPAddress) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "admin only");
        tokenMoveAddress = _tokenMoveAddress;
        tokenMoveEthLPAddress = _tokenMoveEthLPAddress;
    }

    // depositing to ST not requiring allowance to ST for MOVE or MOVE-ETH LP
    function depositToTreasury(uint _tokenMoveAmount, uint _tokenMoveEthAmount) public {
        if (_tokenMoveAmount > 0) {
            IERC20(tokenMoveAddress).safeTransferFrom(msg.sender, smartTreasury, _tokenMoveAmount);
        }
        if (_tokenMoveEthAmount > 0) {
            IERC20(tokenMoveEthLPAddress).safeTransferFrom(msg.sender, smartTreasury, _tokenMoveEthAmount);
        }
        ISmartTreasury(smartTreasury).depositOnBehalf(msg.sender, _tokenMoveAmount, _tokenMoveEthAmount);
    }

    // burn of MOVE tokens not requiring allowance so ST for MOVE
    function claimAndBurn(uint _amount) public {
        // burn bonus portion and send USDC
        ISmartTreasury(smartTreasury).claimAndBurnOnBehalf(msg.sender, _amount);
        // burn MOVE tokens (after USDC calculation and transfer complete to have proper totalSupply)
        IBurnable(tokenMoveAddress).burnFrom(msg.sender, _amount);
    }

    // subsidized sending of ERC20 token to another address
    function executeSendOnBehalf(address _beneficiary, address _token, address _destination, uint256 _amount, uint256 _bonus) public {
        require(hasRole(TRUSTED_EXECUTION_ROLE, msg.sender), "trusted executor only");

        ISmartTreasury(smartTreasury).spendBonus(_beneficiary, _bonus);

        // perform transfer, assuming this contract has allowance
        if (transferFee == 0) {
            IERC20(_token).safeTransferFrom(_beneficiary, _destination, _amount);
        } else {
            uint256 feeAmount = _amount.mul(transferFee).div(1e18);
            IERC20(_token).safeTransferFrom(_beneficiary, address(this), _amount);
            IERC20(_token).safeTransfer(_destination, _amount.sub(feeAmount));
        }
    }

    // subsidized deposit of assets to pool
    function executeDepositOnBehalf(address _beneficiary, address _token, address _pool, uint256 _amount, uint256 _expectedMinimumReceived, bytes memory _convertData, uint256 _bonus) public {
        require(hasRole(TRUSTED_EXECUTION_ROLE, msg.sender), "trusted executor only");

        ISmartTreasury(smartTreasury).spendBonus(_beneficiary, _bonus);

        // perform deposit, assuming this contract has allowance
        // TODO: check deposit on behalf with raw Eth! it's not supported but that it reverts;
        // TODO: check if swap would be executed properly;
        depositToPoolOnBehalf(_beneficiary, _pool, _token, _amount, _expectedMinimumReceived, _convertData);
    }

    // subsidized withdraw of assets from pool
    function executeWithdrawOnBehalf(address _beneficiary, address _pool, uint256 _amount, uint256 _bonus) public {
        require(hasRole(TRUSTED_EXECUTION_ROLE, msg.sender), "trusted executor only");

        ISmartTreasury(smartTreasury).spendBonus(_beneficiary, _bonus);

        withdrawFromPoolOnBehalf(_beneficiary, _pool, _amount);
    }
    
    // subsidized swap of ERC20 assets (also possible swap to raw Eth)
    function executeSwapOnBehalf(address _beneficiary, address _tokenFrom, address _tokenTo, uint256 _amountFrom, uint256 _expectedMinimumReceived, bytes memory _convertData, uint256 _bonus) public {
        require(hasRole(TRUSTED_EXECUTION_ROLE, msg.sender), "trusted executor only");

        ISmartTreasury(smartTreasury).spendBonus(_beneficiary, _bonus);

        // TODO: check deposit on behalf with raw Eth! it's not supported but that it reverts;
        executeSwapOnBehalf(_beneficiary, _tokenFrom, _tokenTo, _amountFrom, _expectedMinimumReceived, _convertData);
    }
}
