// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestLPToken is ERC20("TestLPToken", "TESTLP") {

    address public founder;

    constructor() public {
        founder = msg.sender;
	    _mint(founder, 55 * 1e18);
    }
}