// contracts/HHToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "./ERC20Permit/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


/*
   "HH", "Holyheld", the Holyheld token contract

   Properties used from OpenZeppelin:
     ERC20PresetMinterPauserUpgradeable.sol -- preset for mintable, pausable, burnable ERC20 token
     ERC20PermitUpgradeable.sol -- ported from drafts (test added) to implement permit()

   V2 updates:
    - added airdrop function to perform mass airdrop of bonus tokens (owner-only)
*/
contract HHTokenV2 is ERC20PresetMinterPauserUpgradeable, ERC20PermitUpgradeable {
    using SafeERC20 for IERC20;

    // initializer is defined within preset
    function initialize(string memory name, string memory symbol) public override initializer {
        __Context_init_unchained();
        __AccessControl_init_unchained();
        __ERC20_init_unchained(name, symbol);
        __ERC20Burnable_init_unchained();
        __Pausable_init_unchained();
        __ERC20Pausable_init_unchained();
        __ERC20PresetMinterPauser_init_unchained(name, symbol);
        __ERC20Permit_init(name);
    }

    function uniqueIdentifier() public pure returns(string memory) {
        return "HolyheldToken";
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20PresetMinterPauserUpgradeable, ERC20Upgradeable) {
        super._beforeTokenTransfer(from, to, amount);
    }

    // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
	}

    // airdrop tokens (used to distributed bonus tokens)
	// callable only by owner
	function airdropTokens(address[] calldata _recipients, uint256[] calldata _amounts) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        require(_recipients.length == _amounts.length, "array length mismatch");
		for(uint256 i = 0; i < _recipients.length; i++) {
            _mint(_recipients[i], _amounts[i]);
        }
	}
}
