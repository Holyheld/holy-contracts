// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent data fetch for bonus token claim
interface IHolyVisor {
    function bonusInfo(address) external view returns(uint256, uint256);
	function bonusTotalUnlocked() external view returns(uint256);
	function bonusTotalTokens() external view returns(uint256);
}
