// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent asset pool interactions
interface IHolyPool {
    function getBaseAsset() external view returns(address);
    function depositOnBehalf(address beneficiary, uint256 amount) external;
}
