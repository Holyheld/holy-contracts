// contracts/HolyPassage.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./HHToken.sol";

contract HolyPassage is AccessControlUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

	//migration time window boundaries
	//TODO: make checks and set these in initializer method, in V2 version, test in-place upgradeability of this contract
	uint256 migrationStartTimestamp;
	uint256 migrationEndTimestamp;

	//OpenZeppelin ERC20 implementation (if ERC20Burnable is not used) won't allow tokens to be sent to 0x0..0 address
	//NOTE: place this address to something claimable to test migration in mainnet with real tokens
	address private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

	IERC20 public oldToken;
	HHToken public newToken;

    function initialize(address _oldToken, address _newToken) public initializer {
		// there are also initializers in AccessControl but they are essentially empty
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        oldToken = IERC20(_oldToken);
		newToken = HHToken(_newToken);
    }

	// data about amount migrated and claimed bonus for all users
	mapping(address => uint256) migratedTokens;
	mapping(address => uint256) claimedBonusTokens;

    event Migrated(address indexed user, uint256 amount);
    event ClaimedBonus(address indexed user, uint256 amount);

	// migrate user HOLY tokens to HH tokens (without multipliers)
	// allowance should be already provided to this contract address by user
	function emergencyMigrate() public {
		uint256 userBalance = oldToken.balanceOf(msg.sender);
		uint256 contractAllowance = oldToken.allowance(msg.sender, address(this));
		require(userBalance > 0, "no tokens to migrate");
		require(contractAllowance >= userBalance, "insufficient allowance");
		oldToken.safeTransferFrom(msg.sender, BURN_ADDRESS, userBalance); // burn old token
		newToken.mint(msg.sender, userBalance); // mint new token to user address
		migratedTokens[msg.sender] += userBalance;
		emit Migrated(msg.sender, userBalance);
	}

	// migrate user HOLY tokens to HH tokens
	// allowance should be already provided to this contract address by user
	function migrate() public {
		uint256 userBalance = oldToken.balanceOf(msg.sender);
		uint256 contractAllowance = oldToken.allowance(msg.sender, address(this));
		require(userBalance > 0, "no tokens to migrate");
		require(contractAllowance >= userBalance, "insufficient allowance");
		oldToken.safeTransferFrom(msg.sender, BURN_ADDRESS, userBalance); // burn old token

		uint256 bonusAmount = getClaimableBonusIncludingMigration(userBalance);
		uint256 totalAmount = userBalance + bonusAmount;
		newToken.mint(msg.sender, totalAmount); // mint new token to user address
		migratedTokens[msg.sender] += userBalance;
		emit Migrated(msg.sender, userBalance);
		if (bonusAmount > 0) {
			emit ClaimedBonus(msg.sender, bonusAmount);
			claimedBonusTokens[msg.sender] += bonusAmount;
		}
	}

	// this function is similar to public getClaimableBonus but takes currently migrating amount into calculation
	function getClaimableBonusIncludingMigration(uint256 currentlyMigratingAmount) private returns(uint256) {
		//TODO: go into HolyVisor and retrieve claimable bonus, take into account the amount is currently migrating
		return 0;
	}

	function getClaimableBonus() public returns(uint256) {
		//TODO: go into HolyVisor and retrieve claimable bonus
		return 0;
	}

    // claim a bonus tokens for sender
	function claimBonus() public {
		claimBonusForAddress(msg.sender);
	}

    // calculate and claim bonus for a single address
    function claimBonusForAddress(address _address) public {
		//TODO: calculate and mint bonus
		uint256 claimableBonusAmount = getClaimableBonus();
		//don't fail if amount is 0 here, it's used for batch airdrops too
	}

	// gets amounts of bonuses available for number of addresses
	// and in case of non-zero amounts mints bonus tokens to user addresses
	// function is public, but it can be gas-expensive and estimated to be called weekly in batches
	function airdropBonuses(address[] memory /* calldata? */ addresses) public {
		uint256 length = addresses.length;
        for (uint256 i = 0; i < length; ++i) {
			claimBonusForAddress(addresses[i]); //TODO: check that if address is provided multiple times it is not a vulnerability
        }
	}

    // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
	}
}





/*
	Migration contract from HOLY token to HH token.
	It is able to mint HH tokens accumulating HOLY tokens which are burned upon migration (transferred to 0x0...00 address)

        The migration procedure includes following steps:
        transaction 1:
        - user approves spending of the HOLY token to the migrator contract (required one-time);
        transaction 2:
        - migrator contract burns HOLY tokens from user wallet;
        - migrator mints exactly the same amount of HH tokens to user wallet;
        - migrator increments the amount of tokens user has migrated (this is used to determine available bonus cap);
	- if address has non-zero claimable bonus tokens, this amount is calculated and transferred too;

	Additional conditions:
	- migration is only available from 20 Jan 2021 to 28 Feb 2021, otherwise migration calls are declined;

        Multiplier handling:
        - contract has a map (user address -> multiplier value);
	- this map is maintained with the following procedure:
		- before bonus tokens are available, multipliers are populated using batch calls for all holders that have multiplier >1.0
                  after LP program finishes;
		- off-chain backend provides the data for available multiplier to application;

	Example:
		- user has migrated 1500 tokens from HOLY to HH;
		- user has achieved bonus of 3.175x for the amount of 5000 tokens;
		This means, that maximum available bonus tokens are:
			(3.175x - 1.0x) * 5000 = 2.175 * 5000 = 10875 tokens
		Before user migrates more HOLY to HH, the maximum amount is capped at:
			(1500/5000) * 10875 = 3262.5 tokens;
		As there is additional vesting mechanics, the amount that is available for claiming currently is:
			user_eligible_amount = (3262.5 - already_claimed_bonus) 

			unlocked_token_total = amount of HH tokens that are available currently (incrementing up to total_bonus_tokens)
			user_bonus_share = (user_maximum_bonus_tokens / total_bonus_tokens)

			if user_bonus_share * unlocked_token_total < user_eligible_amount
				claimable = user_bonus_share * unlocked_token_total
			else
				claimable = user_eligible_amount (e.g. all bonus tokens are unvested or user migrated portion is smaller)

			NOTE: by using such formula, user that e.g. sold many HOLY and migrated only a fraction to HH, gets available bonus
				unlocked earlier (which may not be considered fair); So the unvesting should be implemented as
				a fraction, not the absolute token amount, as:

			unvested_bonus_portion = unlocked_token_total / total_bonus_tokens (changes from 0.0 to 1.0)
			claimable = user_eligible_amount * unvested_bonus_portion

		All data is available on-chain:
		- multipliers for addresses and cap amounts for addresses are written after LP migration ends into map in this contract;
		- total bonus token amount is written in this contract;
		- unlocked token amount is tracked by the HolyVisor contract;
		- how many tokens address had migrated is managed by this contract;
		- how many bonus tokens address had received is managed by this contract;
		- inside migration time window, migration of tokens includes seamless claim of bonus tokens if available;

		All non-zero amounts of bonus tokens could be airdropped automatically on a weekly basis (to keep gas costs reasonable);
		- this is function that can be called by anyone (but it could be very gas expensive)
			AirdropBonusTokens(address[]) -- addresses to check and airdrop bonus HH to (all addresses may not fit into one transaction);

	Safety measures (could be called only by owner):
		- freeze/unfreeze bonus program;
		- freeze/unfreeze migration;
		- change migration time window;
		- change total bonus tokens amount;
		- change multiplier and cap amount for particular address;

*/