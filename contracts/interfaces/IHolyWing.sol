// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent middleware contract for swapping tokens
interface IHolyWing {
    // returns amount of 'destination token' that 'source token' was swapped to
    function executeSwap(address tokenFrom, address tokenTo, uint256 amount, bytes calldata data) external returns(uint256);
}
