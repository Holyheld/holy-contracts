// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

// Interface to represent a portion of HolyKnight onlyOwner methods 
// does not include add pool
interface IHolyKnightRestricted {
    function setReserve(uint256) external;
    function set(uint256, uint256, bool) external;
    function putToTreasury(address) external;
    function putToTreasuryAmount(address, uint256) external;
}
