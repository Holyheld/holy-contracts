// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent asset pool interactions
interface ISmartTreasury {
    function spendBonus(address _account, uint256 _amount) external;
    function depositOnBehalf(address _account, uint _tokenMoveAmount, uint _tokenMoveEthAmount) external;
    function claimAndBurnOnBehalf(address _beneficiary, uint256 _amount) external;
}


