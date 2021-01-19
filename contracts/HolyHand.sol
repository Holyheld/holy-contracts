// contracts/HolyHand.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IHolyPool.sol";
import "./interfaces/IHolyWing.sol";


/*
    HolyHand is a transfer proxy contract for ERC20 and ETH transfers through Holyheld infrastructure (deposit/withdraw to HolyPool)
    - extract fees;
    - call token conversion if needed;
    - deposit/withdraw tokens into HolyPool;
    - non-custodial, not holding any funds;

    This contract is a single address that user grants allowance to on any ERC20 token.
    This contract could be upgraded in the future to provide subsidized transactions.
*/
contract HolyHand is AccessControlUpgradeable {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  // if greater than zero, this is a percentage fee applied to all deposits
  uint256 public depositFee;
  // if greater than zero, this is a percentage fee applied to exchange operations with HolyWing proxy
  uint256 public exchangeFee;

  IHolyWing private exchangeProxy;

  uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

  function initialize() public initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
  }

  function depositToPool(address _poolAddress, address _token, uint256 amount, bytes memory convertData) public {
    IHolyPool holyPool = IHolyPool(_poolAddress);
    address poolToken = holyPool.getBaseAsset();
    if (poolToken == _token) {
      // no conversion is needed, allowance and balance checks performed in ERC20 token
      // and not here to not waste any gas fees
      IERC20(_token).safeTransferFrom(msg.sender, address(this), amount);
      // process fees if present
      if (depositFee > 0) {
        //TODO: process transfer fees and deposit remainder
      } else {
        holyPool.depositOnBehalf(msg.sender, amount);
      }
      return;
    }
    // conversion is needed
    IHolyWing holyWing = IHolyWing(exchangeProxy);
    // HolyWing must have allowance
    if (IERC20(_token).allowance(address(this), address(exchangeProxy)) < amount) {
      IERC20(_token).approve(address(exchangeProxy), ALLOWANCE_SIZE);
    }
    uint256 amountNew = holyWing.executeSwap(_token, poolToken, amount, convertData);

    // process fees if present
    if (depositFee > 0) {
      //TODO: process transfer fees and deposit remainder
    }
    if (exchangeFee > 0) {
      //TODO: process exchange fee and deposit remainder
    }
    holyPool.depositOnBehalf(msg.sender, amountNew);
  }

  // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
	}
}