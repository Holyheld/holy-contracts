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

    // Treasury
    // accumulates LP yield
    address public treasury;

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

    uint public constant AMOUNT_FOUNDER = 1000000 * 1e18;
    uint public constant AMOUNT_TIMEVESTED = 9000000 * 1e18;
    uint public constant AMOUNT_GROWTHVESTED = 10000000 * 1e18;
    uint public constant POOL_SUPPLY = 24000000 * 1e18;
    uint public constant POOL_RESERVE = 2400000 * 1e18;
    uint public constant MAIN_SUPPLY = 56000000 * 1e18;


    uint public constant MAIN_SUPPLY_PERIOD = 127 days;

    // parameters for HolyKnight construction
    uint public constant START_LP_BLOCK = 0;
    //uint public constant START_LP_BLOCK = 10879960;
    // used for tokens per block calculation to distribute in about 4 months
    uint public constant END_LP_BLOCK = 10000;
    //uint public constant END_LP_BLOCK = 11669960;

    // Constructor code is only run when the contract
    // is created
    constructor(address _treasuryaddr) public {
        founder = msg.sender;	  //address that deployed contract becomes initial founder
        treasury = _treasuryaddr; //treasury address is created beforehand

        // Timelock contract will hold main supply for 4 months till Jan 2021
	    main_supply = address(new HolderTimelock(this, founder, block.timestamp + MAIN_SUPPLY_PERIOD));

        // TVL metric based vesting
	    growthvested_supply = address(new HolderTVLLock(this, founder, block.timestamp + 5 minutes));

        // Standard vesting
	    timevested_supply = address(new HolderVesting(founder, block.timestamp, 60, 365 days, false));

        // HOLY token distribution though liquidity mining
	    pool_supply = address(new HolyKnight(this, founder, treasury, POOL_SUPPLY, POOL_RESERVE, START_LP_BLOCK, END_LP_BLOCK));

        //allocate tokens to addresses upon creation, no further minting possible
	    _mint(founder, AMOUNT_FOUNDER);
	    _mint(timevested_supply, AMOUNT_TIMEVESTED);
	    _mint(growthvested_supply, AMOUNT_GROWTHVESTED);
	    _mint(pool_supply, POOL_SUPPLY);
	    _mint(main_supply, MAIN_SUPPLY); 
    }
}