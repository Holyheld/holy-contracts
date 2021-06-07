// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent burnable ERC20 tokens
interface IBurnable {
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external; 
}
