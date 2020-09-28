// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./HolyKnight.sol";


/**
 * @dev // HolyPaladin is a contract that should mitigate treasury vulnerability
 *
 * if team multisig acts as a malicious actor, it is possible to withdraw
 * user funds, this contract becoming the owner of HolyKnight will address that issue
 */
contract HolyPaladin {
    // The HolyKnight contract
    HolyKnight public holyknight;

    // The managing multisig wallet
    address public teamaddr;

    constructor(
        HolyKnight _contract,
        address _teamaddr
    ) public {
        holyknight = _contract;
        teamaddr = _teamaddr;
    }

    /**
     * @dev Throws if called by any account other than the team address.
     */
    modifier onlyTeam() {
        require(teamaddr == msg.sender, "team only");
        _;
    }

    function setTeamAddress(address _teamaddr) public onlyTeam {
        teamaddr = _teamaddr;
    }

    function setReserve(uint256 _reservedPercent) public onlyTeam {
        holyknight.setReserve(_reservedPercent);
    }

    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) public onlyTeam {
        holyknight.set(_pid, _allocPoint, _withUpdate);
    }

    function putToTreasury(address _token) public onlyTeam {
        holyknight.putToTreasury(_token);
    }

    function putToTreasuryAmount(address _token, uint256 _amount) public onlyTeam {
        holyknight.putToTreasuryAmount(_token, _amount);
    }
}
