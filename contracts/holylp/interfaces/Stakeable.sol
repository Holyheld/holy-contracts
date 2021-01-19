// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

// Interface to represent a contract in pools that requires additional
// deposit and withdraw of LP tokens. One of the examples at the time of writing
// is Yearn vault, which takes yCRV which is already LP token and returns yyCRV 
interface Stakeable {
    function deposit(uint) external;
    function withdraw(uint) external;
}
