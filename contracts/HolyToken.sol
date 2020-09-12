// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./vesting/HolderTimelock.sol";
import "./vesting/HolderTVLLock.sol";
import "./vesting/HolderVesting.sol";
import "./HolyKnight.sol";

// HolyToken. Ownable, fixed-amount (non-mintable) with governance to be added
contract HolyToken is ERC20("HolyToken", "HOLY"), Ownable {

    // main developers (founders) multi-sig wallet
    // 1 mln tokens
    address public founder;

    // weekly vested supply, reclaimable by 2% in a week by founder (WeeklyVested contract)
    // 9 mln
    address public timevested_supply;

    // TVL-growth vested supply, reclaimable by 2% in a week if TVL is a new ATH (TVLVested contract)
    // 10 mln
    address public growthvested_supply;

    // main supply, locked for 4 months (TimeVested contract)
    // 56 mln
    address public main_supply;
    
    // Pool supply (ruled by HolyKnight contract)
    // 24 mln
    address public pool_supply;

    uint public constant MAIN_SUPPLY_PERIOD = 127 days;
    uint public constant TOKENS_PER_BLOCK = 100;
    //uint public constant START_LP_BLOCK = 10850000;

    // Constructor code is only run when the contract
    // is created
    constructor() public {
        founder = msg.sender;	//address that deployed contract becomes initial founder

        // Timelock contract will hold main supply for 4 months till Jan 2021
	    main_supply = address(new HolderTimelock(this, founder, block.timestamp + MAIN_SUPPLY_PERIOD));

        // TVL metric based vesting
	    growthvested_supply = address(new HolderTVLLock(this, founder, block.timestamp + 5 minutes));

        // Standard vesting
	    timevested_supply = address(new HolderVesting(founder, block.timestamp, 60, 365 days, false));

        // HOLY token distribution though liquidity mining
	    pool_supply = address(new HolyKnight(this, founder, TOKENS_PER_BLOCK, block.number /*START_LP_BLOCK*/));

        //allocate tokens to addresses upon creation, no further minting possible
	    _mint(founder, 1000000);
	    _mint(timevested_supply, 9000000);
	    _mint(growthvested_supply, 10000000);
	    _mint(pool_supply, 24000000);
	    _mint(main_supply, 56000000); 
    }
}