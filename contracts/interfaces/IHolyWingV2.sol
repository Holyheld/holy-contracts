// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent middleware contract for swapping tokens
interface IHolyWingV2 {
    // returns amount of 'destination token' that 'source token' was swapped to
    // NOTE: HolyWing grants allowance to arbitrary address (with call to contract that could be forged) and should not hold any funds
    function executeSwap(address tokenFrom, address tokenTo, uint256 amount, bytes calldata data) payable external returns(uint256);

    function executeSwapDirect(address beneficiary, address tokenFrom, address tokenTo, uint256 amount, uint256 fee, bytes calldata data) payable external returns(uint256);
}
