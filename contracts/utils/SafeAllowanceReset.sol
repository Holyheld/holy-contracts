// contracts/utils/SafeAllowanceReset.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

abstract contract SafeAllowanceReset {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  // this function exists due to OpenZeppelin quirks in safe allowance-changing methods
  // we don't want to set allowance by small chunks as it would cost more gas for users
  // and we don't want to set it to zero and then back to value (this makes no sense security-wise in single tx)
  // from the other side, using it through safeIncreaseAllowance could revery due to SafeMath overflow
  // Therefore, we calculate what amount we can increase allowance on to refill it to max uint256 value
  function resetAllowanceIfNeeded(IERC20 _token, address _spender, uint256 _amount) internal {
    uint256 allowance = _token.allowance(address(this), _spender);
    if (allowance < _amount) {
      uint256 newAllowance = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
      IERC20(_token).safeIncreaseAllowance(address(_spender), newAllowance.sub(allowance));
    }
  }
}
