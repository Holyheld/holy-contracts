// contracts/HolyHandV2.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IHolyPoolV2.sol";
import "./interfaces/IHolyWing.sol";
import "./interfaces/IHolyWingV2.sol";
import "./interfaces/IHolyRedeemer.sol";
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
*/
contract HolyHandV2 is AccessControlUpgradeable, SafeAllowanceReset {
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
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        exchangeProxyContract = IHolyWing(_exchangeProxyContract);
    }

    function setYieldDistributor(
        address _tokenAddress,
        address _distributorAddress
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
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
        bytes memory convertData
    ) public payable {
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
                    msg.sender,
                    _poolAddress,
                    _amount
                );

                // call pool function to process deposit (without transfer)
                holyPool.depositOnBehalfDirect(msg.sender, _amount);
                return;
            }

            IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

            // HolyPool must have sufficient allowance (one-time for pool/token pair)
            resetAllowanceIfNeeded(poolToken, _poolAddress, _amount);

            // process deposit fees and deposit remainder
            uint256 feeAmount = _amount.mul(depositFee).div(1e18);
            holyPool.depositOnBehalf(msg.sender, _amount.sub(feeAmount));
            return;
        }

        // conversion is required, perform swap through exchangeProxy (HolyWing)
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransferFrom(
                msg.sender,
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
                    convertData
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
            holyPool.depositOnBehalf(msg.sender, amountReceived);
        } else {
            // swap directly to HolyPool address and execute direct deposit call
            uint256 amountReceived =
                IHolyWingV2(address(exchangeProxyContract)).executeSwapDirect{value: msg.value}(
                    _poolAddress,
                    _token,
                    address(poolToken),
                    _amount,
                    exchangeFee,
                    convertData
                );
            require(
                amountReceived >= _expectedMinimumReceived,
                "minimum swap amount not met"
            );
            holyPool.depositOnBehalfDirect(msg.sender, amountReceived);
        }
    }

    function withdrawFromPool(address _poolAddress, uint256 _amount) public {
        IHolyPoolV2 holyPool = IHolyPoolV2(_poolAddress);
        IERC20 poolToken = IERC20(holyPool.getBaseAsset());
        uint256 amountBefore = poolToken.balanceOf(address(this));
        holyPool.withdraw(msg.sender, _amount);
        uint256 withdrawnAmount =
            poolToken.balanceOf(address(this)).sub(amountBefore);

        // if amount is less than expected, transfer anyway what was actually received
        if (withdrawFee > 0) {
            // process withdraw fees
            uint256 feeAmount = withdrawnAmount.mul(withdrawFee).div(1e18);
            poolToken.safeTransfer(msg.sender, withdrawnAmount.sub(feeAmount));
        } else {
            poolToken.safeTransfer(msg.sender, withdrawnAmount);
        }
    }

    function setDepositFee(uint256 _depositFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        depositFee = _depositFee;
        emit FeeChanged("deposit", _depositFee);
    }

    function setExchangeFee(uint256 _exchangeFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        exchangeFee = _exchangeFee;
        emit FeeChanged("exchange", _exchangeFee);
    }

    function setWithdrawFee(uint256 _withdrawFee) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        withdrawFee = _withdrawFee;
        emit FeeChanged("withdraw", _withdrawFee);
    }

    // token swap function (could be with fees but also can be subsidized later)
    // perform conversion through exhcnageProxy (HolyWing)
    function executeSwap(
        address _tokenFrom,
        address _tokenTo,
        uint256 _amountFrom,
        uint256 _expectedMinimumReceived,
        bytes memory convertData
    ) public payable {
        require(_tokenFrom != _tokenTo, "Same tokens provided");

        // swap with direct transfer to HolyWing and HolyWing would transfer swapped token (or ETH) back to msg.sender
        if (_tokenFrom != ETH_TOKEN_ADDRESS) {
            IERC20(_tokenFrom).safeTransferFrom(
                msg.sender,
                address(exchangeProxyContract),
                _amountFrom
            );
        }
        uint256 amountReceived =
            IHolyWingV2(address(exchangeProxyContract)).executeSwapDirect{value: msg.value}(
                msg.sender,
                _tokenFrom,
                _tokenTo,
                _amountFrom,
                exchangeFee,
                convertData
            );
        require(
            amountReceived >= _expectedMinimumReceived,
            "minimum swap amount not met"
        );
    }

    // TODO: token send function (could be with fees but also can be subsidized)

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
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransfer(_destination, _amount);
        } else {
            payable(_destination).sendValue(_amount);
        }
        emit EmergencyTransfer(_token, _destination, _amount);
    }
}
