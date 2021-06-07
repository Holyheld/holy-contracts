// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to Sushi's MasterChef for staking/unstaking of SLP token
interface IMasterChef {
    // Deposit LP tokens to MasterChef for SUSHI allocation
    function deposit(uint256 _pid, uint256 _amount) external;

    // Withdraw LP tokens from MasterChef
    function withdraw(uint256 _pid, uint256 _amount) external;

    // View function to see pending SUSHIs
    function pendingSushi(uint256 _pid, address _user) external view returns (uint256);
}
