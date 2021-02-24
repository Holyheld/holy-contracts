// contracts/HolyHand.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IHolyPool.sol";
import "./interfaces/IHolyWing.sol";
import "./interfaces/IHolyRedeemer.sol";


/*
    HolyHand is a transfer proxy contract for ERC20 and ETH transfers through Holyheld infrastructure (deposit/withdraw to HolyPool)
    - extract fees;
    - call token conversion if needed;
    - deposit/withdraw tokens into HolyPool;
    - non-custodial, not holding any funds;

    This contract is a single address that user grants allowance to on any ERC20 token.
    This contract could be upgraded in the future to provide subsidized transactions.

    TODO: if token supports permit, provide ability to execute without separate approve()
*/
contract HolyHand is AccessControlUpgradeable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

  // if greater than zero, this is a percentage fee applied to all deposits
  uint256 public depositFee;
  // if greater than zero, this is a percentage fee applied to exchange operations with HolyWing proxy
  uint256 public exchangeFee;
  // if greater than zero, this is a percentage fee applied to withdraw operations
  uint256 public withdrawFee;

  // HolyWing exchange proxy/middleware
  IHolyWing private exchangeProxyContract;

  // HolyRedeemer yield distributor
  // NOTE: to keep overhead for users minimal, fees are not transferred
  // immediately, but left on this contract balance, yieldDistributor can reclaim them
  address private yieldDistributorAddress;

  event TokenSwap(address indexed tokenFrom, address indexed tokenTo, address sender, uint256 amountFrom, uint256 expectedMinimumReceived, uint256 amountReceived);

  event FeeChanged(string indexed name, uint256 value);
  
  event EmergencyTransfer(address indexed token, address indexed destination, uint256 amount);

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

  function setYieldDistributor(address _tokenAddress, address _distributorAddress) public {
    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
    yieldDistributorAddress = _distributorAddress;
    // only yield to be redistributed should be present on this contract in baseAsset (or other tokens if swap fees)
    // so no access to lp tokens for the funds invested
    IERC20(_tokenAddress).approve(_distributorAddress, ALLOWANCE_SIZE);
  }

  // if the pool baseToken matches the token deposited, then no conversion is performed 
  // and _expectedMininmumReceived/convertData should be zero/empty
  function depositToPool(address _poolAddress, 
                         address _token, 
                         uint256 _amount,
                         uint256 _expectedMinimumReceived, 
                         bytes memory convertData) public {
    IHolyPool holyPool = IHolyPool(_poolAddress);
    IERC20 poolToken = IERC20(holyPool.getBaseAsset());
    if (address(poolToken) == _token) {
      // no conversion is needed, allowance and balance checks performed in ERC20 token
      // and not here to not waste any gas fees
      IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

      // HolyPool must have sufficient allowance (one-time for pool/token pair)
      if (poolToken.allowance(address(this), _poolAddress) < _amount) {
        poolToken.approve(_poolAddress, ALLOWANCE_SIZE);
      }

      // process fees if present
      if (depositFee > 0) {
        // process deposit fees and deposit remainder
        uint256 feeAmount = _amount.mul(depositFee).div(1e18);
        //poolToken.safeTransfer(yieldDistributorAddress, feeAmount);
        holyPool.depositOnBehalf(msg.sender, _amount.sub(feeAmount));
      } else {
        holyPool.depositOnBehalf(msg.sender, _amount);
      }
      return;
    }

    // TODO: ETH conversion (not as token, but value in call)
    
    // exchangeProxyContract.executeSwap{value:msg.value}(_token, address(poolToken), _amount, convertData);

    // conversion is required, perform through exhcnageProxy (HolyWing)

    IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

    // HolyWing must have allowance
    if (IERC20(_token).allowance(address(this), address(exchangeProxyContract)) < _amount) {
      IERC20(_token).approve(address(exchangeProxyContract), ALLOWANCE_SIZE);
    }
    uint256 amountNew = exchangeProxyContract.executeSwap(_token, address(poolToken), _amount, convertData);
    require(amountNew >= _expectedMinimumReceived, "minimum swap amount not met");

    // process exchange/deposit fees if present
    if (exchangeFee > 0 || depositFee > 0) {
      uint256 feeAmount = amountNew.mul(exchangeFee).div(1e18);
      feeAmount = feeAmount.add(feeAmount.mul(depositFee).div(1e18));
      //poolToken.safeTransfer(yieldDistributorAddress, feeAmount);
      amountNew = amountNew.sub(feeAmount);
    } 

    // HolyPool must have sufficient allowance (one-time for pool/token pair)
    if (poolToken.allowance(address(this), _poolAddress) < _amount) {
      poolToken.approve(_poolAddress, ALLOWANCE_SIZE);
    }

    // perform actual deposit call
    holyPool.depositOnBehalf(msg.sender, amountNew);
  }

  function withdrawFromPool(address _poolAddress, uint256 _amount) public {
    IHolyPool holyPool = IHolyPool(_poolAddress);
    IERC20 poolToken = IERC20(holyPool.getBaseAsset());
    uint256 amountBefore = poolToken.balanceOf(address(this));
    holyPool.withdraw(msg.sender, _amount);
    uint256 withdrawnAmount = poolToken.balanceOf(address(this)).sub(amountBefore); 
    
    // process withdraw fees if present
    if (withdrawFee > 0) {
      uint256 feeAmount = withdrawnAmount.mul(withdrawFee).div(1e18);
      //poolToken.safeTransfer(yieldDistributorAddress, feeAmount);
      poolToken.safeTransfer(msg.sender, withdrawnAmount.sub(feeAmount));
    } else {
      poolToken.safeTransfer(msg.sender, withdrawnAmount);
    }    
    //TODO: if amount is less than expected, transfer anyway
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
  function executeSwap(address _tokenFrom, 
                       address _tokenTo,
                       uint256 _amountFrom, 
                       uint256 _expectedMinimumReceived, 
                       bytes memory convertData) public {
    require(_tokenFrom != _tokenTo, "Same tokens provided");

    IERC20(_tokenFrom).safeTransferFrom(msg.sender, address(this), _amountFrom);
    uint256 amountToSwap = _amountFrom;

    // process exchange/deposit fees if present (in deposit we get pool tokens, so process fees after swap, here we take fees in source token)
    if (exchangeFee > 0 || depositFee > 0) {
      uint256 feeAmount = _amountFrom.mul(exchangeFee).div(1e18);
      feeAmount = feeAmount.add(feeAmount.mul(depositFee).div(1e18));
      //poolToken.safeTransfer(yieldDistributorAddress, feeAmount);
      amountToSwap = amountToSwap.sub(feeAmount);
    } 
    
    // HolyWing must have allowance
    if (IERC20(_tokenFrom).allowance(address(this), address(exchangeProxyContract)) < amountToSwap) {
      IERC20(_tokenFrom).approve(address(exchangeProxyContract), ALLOWANCE_SIZE);
    }

    uint256 amountReceived = exchangeProxyContract.executeSwap(_tokenFrom, _tokenTo, amountToSwap, convertData);
    require(amountReceived >= _expectedMinimumReceived, "minimum swap amount not met");

    // transfer swapped tokens back to caller
    IERC20(_tokenTo).safeTransfer(msg.sender, amountReceived);

    emit TokenSwap(_tokenFrom, _tokenTo, msg.sender, _amountFrom, _expectedMinimumReceived, amountReceived);
  }

  // TODO: token send function (could be with fees but also can be subsidized)

  // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
    emit EmergencyTransfer(_token, _destination, _amount);
	}

  // this function is similar to emergencyTransfer, but relates to yield distribution
  // fees are not transferred immediately to save gas costs for user operations
  // so they accumulate on this contract address and can be claimed by HolyRedeemer
  // when appropriate. Anyway, no user funds should appear on this contract, it
  // only performs transfers, so such function has great power, but should be safe
  // It does not include approval, so may be used by HolyRedeemer to get fees from swaps
  // in different small token amounts
  function claimFees(address _token, uint256 _amount) public {
		require(msg.sender == yieldDistributorAddress, "yield distributor only");
		IERC20(_token).safeTransfer(msg.sender, _amount);
	}
}