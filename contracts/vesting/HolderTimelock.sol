// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/TokenTimelock.sol";


contract HolderTimelock is TokenTimelock {
  constructor(
    IERC20 _token, 
    address _beneficiary,
    uint256 _releaseTime
  )
    TokenTimelock(_token, _beneficiary, _releaseTime)
    public
  {}
}