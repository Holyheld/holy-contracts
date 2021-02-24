// contracts/HolyPassageV3.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IHolyVisor.sol";
import "./HHToken.sol";

/*
	HolyPassage is a migration contract from HOLY token to HH token.
	It is able to mint HH tokens accumulating HOLY tokens which are burned upon migration (transferred to 0x0...00 address)

    The migration procedure includes following steps:
        transaction 1:
        - user approves spending of the HOLY token to the migrator contract (required one-time);
        transaction 2:
        - migrator contract burns HOLY tokens from user wallet;
        - migrator mints exactly the same amount of HH tokens to user wallet;
        - migrator increments the amount of tokens user has migrated (this is used to determine available bonus cap);

	- if address has non-zero claimable bonus tokens, this amount is calculated and transferred too during migration call;

	Additional conditions:
	- migration is only available from 20 Jan 2021 to 28 Feb 2021, otherwise migration calls are declined;

	Safety measures (could be called only by owner):
		- freeze/unfreeze bonus program;
		- freeze/unfreeze migration;
		- change migration time window setMigrationWindow();
		- change total bonus tokens amount (in HolyVisor setTotalAmount());
		- change multiplier and cap amount for particular address (in HolyVisor setData());

	All non-zero amounts of bonus tokens could be airdropped automatically on a weekly basis (to keep gas costs reasonable);
		- this is function that can be called by anyone (but it could be very gas expensive)
		  airdropBonuses(address[]) -- addresses to check and airdrop bonus HH to (all addresses may not fit into one transaction);
*/
contract HolyPassageV3 is AccessControlUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

	//migration time window boundaries
	uint256 public migrationStartTimestamp;
	uint256 public migrationEndTimestamp;

	//OpenZeppelin ERC20 implementation (if ERC20Burnable is not used) won't allow tokens to be sent to 0x0..0 address
	//NOTE: place this address to something claimable to test migration in mainnet with real tokens
	address private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

	IERC20 public oldToken;
	HHToken public newToken;

    function initialize(address _oldToken, address _newToken) public initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

        oldToken = IERC20(_oldToken);
		newToken = HHToken(_newToken);
    }

	// data about amount migrated and claimed bonus for all users
	mapping(address => uint256) public migratedTokens;
	mapping(address => uint256) public claimedBonusTokens;

    event Migrated(address indexed user, uint256 amount);
    event ClaimedBonus(address indexed user, uint256 amount);

	//HolyVisor is a contract that handles bonus multipliers data
	IHolyVisor private holyVisor;

	// enable/disable flags
	bool public migrationEnabled;
	bool public bonusClaimEnabled;

	// migrate user HOLY tokens to HH tokens (without multipliers)
	// allowance should be already provided to this contract address by user
	function emergencyMigrate() public {
		require(block.timestamp >= migrationStartTimestamp && block.timestamp < migrationEndTimestamp, "time not in migration window");
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
		require(migrationEnabled, "migration disabled");
		require(block.timestamp >= migrationStartTimestamp && block.timestamp < migrationEndTimestamp, "time not in migration window");
		uint256 userBalance = oldToken.balanceOf(msg.sender);
		uint256 contractAllowance = oldToken.allowance(msg.sender, address(this));
		require(userBalance > 0, "no tokens to migrate");
		require(contractAllowance >= userBalance, "insufficient allowance");
		oldToken.safeTransferFrom(msg.sender, BURN_ADDRESS, userBalance); // burn old token

		//don't call claimBonusForAddress() to save some gas and mint in one call
		uint256 bonusAmount = getClaimableBonusIncludingMigration(msg.sender, userBalance);
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
	function getClaimableBonusIncludingMigration(address _account, uint256 _currentlyMigratingAmount) private view returns(uint256) {
		if (!bonusClaimEnabled) {
			return 0;
		}

		// go into HolyVisor and retrieve claimable bonus, take into account the amount is currently migrating
		uint256 userMultiplier = 0;
		uint256 userAmountCap = 0;
		uint256 totalUnlocked = 0;
		uint256 totalBonusAmount = 0;

		if (address(holyVisor) != address(0)) {
			(userMultiplier, userAmountCap) = holyVisor.bonusInfo(_account);
			totalUnlocked = holyVisor.bonusTotalUnlocked();
			totalBonusAmount = holyVisor.bonusTotalTokens();
		}

		// we don't want to divide by zero or underflow
		// if totalBonusAmount is 0 -- then no bonuses are available for anyone
		// if any of user metrics are 0 -- then for this user no bonues are available
		if (totalBonusAmount == 0 || userMultiplier == 0 || userAmountCap == 0 || totalUnlocked == 0) {
			return 0;
		}

		// we don't interfere with cap in UnlockUpdate(), but limit amount here for additional protection
		if (totalUnlocked > totalBonusAmount) {
			totalUnlocked = totalBonusAmount;
		}

		uint256 userClaimedBonus = claimedBonusTokens[_account];
		uint256 userMigratedTokens = migratedTokens[_account];

		uint256 userMigratedBonusCapped = userMigratedTokens.add(_currentlyMigratingAmount);
		if (userMigratedBonusCapped > userAmountCap) {
			userMigratedBonusCapped = userAmountCap; // even if bought more tokens than farmed, bonus would not go higher
		}

		// user multiplier should be in form of 1000000000000000000 meaning 1.0x 3750000000000000000 meaning 3.75x
		userMigratedBonusCapped = userMultiplier.sub(1e18).mul(userMigratedBonusCapped).div(1e18);

		uint256 unvestedBonusPortion = totalUnlocked.mul(1e18).div(totalBonusAmount); // fraction multiplied by 1e18
		if (unvestedBonusPortion > 1e18) {
			unvestedBonusPortion = 1e18;
		}
		// this should not be more than 1.0 (1 * 1e18)
		//uint256 unvestedUserAmount = userMigratedBonusCapped.mul(unvestedBonusPortion).div(1e18); // this is total portion unlocked for user (incl. already claimed)

		return userMigratedBonusCapped.mul(unvestedBonusPortion).div(1e18).sub(userClaimedBonus);
	}

	function getClaimableBonus() public view returns(uint256) {
		return getClaimableBonusIncludingMigration(msg.sender, 0);
	}

    // get claimable bonus amount including migration
	function getClaimableMigrationBonus() public view returns(uint256) {
		uint256 userBalance = oldToken.balanceOf(msg.sender);
		return getClaimableBonusIncludingMigration(msg.sender, userBalance);
	}

    // claim a bonus tokens for sender
	function claimBonus() public {
		require(bonusClaimEnabled, "bonus claim disabled");
		claimBonusForAddress(msg.sender);
	}

    // NOTE: user can decrease allowance, thus, claim is not the same as migrate,
	// during claim only actually migrated tokens are taken into consideration

	// NOTE: require(bonusClaimEnabled, "bonus claim disabled"); is not placed here to save gas 
	// as this method is not to be called from the app, but for airdrop
	// (getClaimableBonusIncludingMigration would return 0 anyway, but not revert)
    // calculate and mint/claim bonus for a single address
    function claimBonusForAddress(address _address) public {
		uint256 bonusAmount = getClaimableBonusIncludingMigration(_address, 0);
		//don't fail if amount is 0 here, it's used for batch airdrops too
		if (bonusAmount > 0) {
			newToken.mint(_address, bonusAmount); // mint new token to user address
			emit ClaimedBonus(_address, bonusAmount);
			claimedBonusTokens[_address] += bonusAmount;
		}
	}

	// gets amounts of bonuses available for number of addresses
	// and in case of non-zero amounts mints bonus tokens to user addresses
	// function is public, but it can be gas-expensive and estimated to be called weekly in batches
	function airdropBonuses(address[] memory /* calldata? */ addresses) public {
		uint256 length = addresses.length;
        for (uint256 i = 0; i < length; ++i) {
			claimBonusForAddress(addresses[i]);
        }
	}

	function setHolyVisor(address _visorAddress) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin oops only");
        holyVisor = IHolyVisor(_visorAddress);
	}

    // set the total amount of bonus tokens (used in unlocked portion calculation)
    function setMigrationWindow(uint256 _fromTimestamp, uint256 _toTimestamp) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        migrationStartTimestamp = _fromTimestamp;
		migrationEndTimestamp = _toTimestamp;
    }

    function setMigrationEnabled(bool _enableMigration) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        migrationEnabled = _enableMigration;
    }

    function setBonusClaimEnabled(bool _enableBonusClaim) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        bonusClaimEnabled = _enableBonusClaim;
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
	Some implementation details
	---------------------------

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
	- how many tokens address had migrated is managed by this contract;
	- how many bonus tokens address had received is managed by this contract;
	- multipliers for addresses and cap amounts for addresses are written after LP migration ends into map in HolyVisor contract;
	- total bonus token amount is written in HolyVisor contract;
	- unlocked token amount is tracked by the HolyVisor contract;
*/