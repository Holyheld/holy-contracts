// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent asset pool interactions
interface IHolyValor {
    // safe amount of funds in base asset (USDC) that is possible to reclaim from this HolyValor without fee/penalty
    function safeReclaimAmount() external view returns(uint256);
    // total amount of funds in base asset (USDC) that is possible to reclaim from this HolyValor
    function totalReclaimAmount() external view returns(uint256);
    // callable only by a HolyPool, retrieve a portion of invested funds, return (just in case) amount transferred
    function reclaimFunds(uint256 amount, bool _safeExecution) external returns(uint256);
}
