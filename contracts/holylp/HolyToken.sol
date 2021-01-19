// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./vesting/HolderTimelock.sol";
import "./vesting/HolderTVLLock.sol";
import "./vesting/HolderVesting.sol";
import "./HolyKnight.sol";

/**
 * @dev // Holyheld token is a ERC20 token for Holyheld.
 *
 * total amount is fixed at 100M HOLY tokens.
 * HOLY token does not have mint functions.
 * It will allocate upon creation the initial transfers
 * of tokens. It is not ownable or having any other
 * means of distribution other than transfers in its constructor. 
 */
// HolyToken. Ownable, fixed-amount (non-mintable) with governance to be added
contract HolyToken is ERC20("Holyheld", "HOLY") {

    // main developers (founders) multi-sig wallet
    // 1 mln tokens
    address public founder;

    // Treasury
    // accumulates LP yield
    address public treasury;

    // weekly vested supply, reclaimable by 2% in a week by founder (WeeklyVested contract)
    // 9 mln
    address public timeVestedSupply;

    // TVL-growth vested supply, reclaimable by 2% in a week if TVL is a new ATH (TVLVested contract)
    // 10 mln
    address public growthVestedSupply;

    // main supply, locked for 4 months (TimeVested contract)
    // 56 mln
    address public mainSupply;
    
    // Pool supply (ruled by HolyKnight contract)
    // 24 mln
    address public poolSupply;

    uint public constant AMOUNT_INITLIQUIDITY = 1000000 * 1e18;
    uint public constant AMOUNT_OPERATIONS = 9000000 * 1e18;
    uint public constant AMOUNT_TEAM = 10000000 * 1e18;
    uint public constant DISTRIBUTION_SUPPLY = 24000000 * 1e18;
    uint public constant DISTRIBUTION_RESERVE_PERCENT = 20;
    uint public constant MAIN_SUPPLY = 56000000 * 1e18;

    uint public constant MAIN_SUPPLY_VESTING_PERIOD = 127 days;
    uint public constant VESTING_START = 2602115200; //8 Oct 2020, changed for tests
    uint public constant VESTING_START_GROWTH = 2604188800; //1 Nov 2020, changed for tests

    // parameters for HolyKnight construction
    uint public constant START_LP_BLOCK = 10950946;
    // used for tokens per block calculation to distribute in about 4 months
    uint public constant END_LP_BLOCK = 11669960;

    // Constructor code is only run when the contract
    // is created
    constructor(address _founder, address _treasuryaddr) public {
        founder = _founder;	  //address that deployed contract becomes initial founder
        treasury = _treasuryaddr; //treasury address is created beforehand

        // Timelock contract will hold main supply for 4 months till Jan 2021
	    mainSupply = address(new HolderTimelock(this, founder, block.timestamp + MAIN_SUPPLY_VESTING_PERIOD));

        // TVL metric based vesting
	    growthVestedSupply = address(new HolderTVLLock(this, founder, VESTING_START_GROWTH));

        // Standard continuous vesting contract
	    timeVestedSupply = address(new HolderVesting(this, founder, VESTING_START, 365 days, false));

        // HOLY token distribution though liquidity mining
	    poolSupply = address(new HolyKnight(this, founder, treasury, DISTRIBUTION_SUPPLY, DISTRIBUTION_RESERVE_PERCENT, START_LP_BLOCK, END_LP_BLOCK));

        //allocate tokens to addresses upon creation, no further minting possible
	    _mint(founder, AMOUNT_INITLIQUIDITY);
	    _mint(timeVestedSupply, AMOUNT_OPERATIONS);
	    _mint(growthVestedSupply, AMOUNT_TEAM);
	    _mint(poolSupply, DISTRIBUTION_SUPPLY);
	    _mint(mainSupply, MAIN_SUPPLY); 
    }
}