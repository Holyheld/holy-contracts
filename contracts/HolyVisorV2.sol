// contracts/HolyVisorV2.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IHolyVisor.sol";

/*
    HolyVisor is the contract that holds multiplier and migration unlock information (oraclized)
    it is mostly static data storage, one value that gets updated is totalAmountUnlocked, which is
    calculated based on price/market cap update coming from oracle.

    Accessible public functions are read-only for getters and bonusInfo() providing 2 values for address in one call
*/
contract HolyVisorV2 is AccessControlUpgradeable, IHolyVisor {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public weightedPrice;
    uint256 public prevWeightedPrice;
    uint256 public weightedMarketCap;
    uint256 public prevWeightedMarketCap;

    uint256 public totalAmountUnlocked; // total amount of bonus tokens that is unlocked
    uint256 public totalBonusTokens; //total amount of bonus tokens to be claimable

    // maps of addresses unlock amounts and multipliers
    mapping(address => uint256) public bonusMultipliers;
    mapping(address => uint256) public bonusAmountCaps; 

    event UnlockOracleUpdate(uint256 weightedPrice, uint256 weightedMarketCap, uint256 bonusPortionUnlocked, uint256 bonusTotalUnlocked);

    bytes32 public constant BONUSORACLE_ROLE = keccak256("BONUSORACLE_ROLE");

	bool public sealUnlock;

    function initialize() public initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(BONUSORACLE_ROLE, _msgSender());
    }

    // convenience method, the mappings are public anyway
    function bonusInfo(address _account) public override view returns (uint256, uint256) {
        return (bonusMultipliers[_account], bonusAmountCaps[_account]);
    }

    function bonusTotalUnlocked() public override view returns (uint256) {
        return totalAmountUnlocked;
    }

    function bonusTotalTokens() public override view returns (uint256) {
        return totalBonusTokens;
    }

    // update unlock information
    // price and mcap are multiplied 1e18 (to simulate fixed point arithmetic)
    // TODO: is only ATH unlocking tokens or any upside wave unlocks them?
    function UnlockUpdate(uint256 newWeightedMarketCap, uint256 newWeightedPrice) public {
        require(hasRole(BONUSORACLE_ROLE, msg.sender), "Oracle only");
        prevWeightedMarketCap = weightedMarketCap;
        prevWeightedPrice = prevWeightedPrice;
        weightedMarketCap = newWeightedMarketCap;
        weightedPrice = newWeightedPrice;
        if (weightedMarketCap > prevWeightedMarketCap) {
            uint256 unlockedTokens = weightedMarketCap.sub(prevWeightedMarketCap).mul(1e18).div(weightedPrice);
            totalAmountUnlocked = totalAmountUnlocked + unlockedTokens;
            //this is capped at migration contract, but cap here to be safe
            if (totalAmountUnlocked > totalBonusTokens) {
                totalAmountUnlocked = totalBonusTokens; // 100% of bonus tokens unlocked
            }
            emit UnlockOracleUpdate(weightedPrice, weightedMarketCap, unlockedTokens, totalAmountUnlocked);
        }
    }

    // return percentage of tokens that was unlocked during previous UnlockUpdate call
    function getDPY() public view returns(uint256) {
        // report 0 as normal value for mobile application requests
        if (prevWeightedMarketCap >= weightedMarketCap || weightedPrice == 0 || totalBonusTokens == 0) {
            return 0;
        }

        return weightedMarketCap.sub(prevWeightedMarketCap).mul(1e18).div(weightedPrice).mul(1e20).div(totalBonusTokens); //percentage of bonus tokens unlocked during last call
    }

    // set the total amount of bonus tokens (used in unlocked portion calculation)
    function setTotalAmount(uint256 _totalBonusTokens) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        totalBonusTokens = _totalBonusTokens;
    }

    // populate information for addresses about multipliers
    function setData(address[] memory /* calldata? */ _accounts, uint256[] memory /* calldata? */ _multipliers, uint256[] memory /* calldata? */ _amountCaps) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        uint256 length = _accounts.length;
        require(length == _multipliers.length, "Multiplier length mismatch");
        require(length == _amountCaps.length, "Cap length mismatch");
        for (uint256 i = 0; i < length; ++i) {
            address account = _accounts[i];
            bonusMultipliers[account] = _multipliers[i];
            bonusAmountCaps[account] = _amountCaps[i];
        }
    }

	// If unlock is not sealed, Admin can reset unlocked bonus counter (if increased too much or some error/manipulation)
    function sealUnlockAmount() public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        sealUnlock = true;
    }

    // function to use in case that amount calculation is manipulated by price/migration spikes
    // etc. Won't reset any amounts already claimed
    function setUnlockAmount(uint256 _unlockedAmount) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        require(sealUnlock == false, "Unlock direct set sealed");
        totalAmountUnlocked = _unlockedAmount;
    }

    // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
	}
}