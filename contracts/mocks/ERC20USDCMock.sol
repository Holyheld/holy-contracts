// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


// Mock of the DAI token to perform local test swaps
contract ERC20USDCMock is ERC20("USDCMock", "TUSDC") {

    // main developers (founders) multi-sig wallet
    // 1 mln tokens
    address public founder;

    uint public constant AMOUNT_INIT = 1000000 * 1e6;

    constructor(address _founder) public {
        founder = _founder;	  //address that deployed contract becomes initial founder
	    _mint(founder, AMOUNT_INIT);
        _setupDecimals(6);
    }
}