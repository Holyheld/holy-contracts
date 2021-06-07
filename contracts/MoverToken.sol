// contracts/MoverToken.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/presets/ERC20PresetMinterPauserUpgradeable.sol";
import "./ERC20Permit/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


/*
   "MOVE", "Mover", the Mover token contract

   Properties used from OpenZeppelin:
     ERC20PresetMinterPauserUpgradeable.sol -- preset for mintable, pausable, burnable ERC20 token
     ERC20PermitUpgradeable.sol -- ported from drafts (test added) to implement permit()

   V2 updates:
    - added airdrop function to perform mass airdrop of bonus tokens (owner-only)

   Mover updates:
    - added function to override name and symbol for rebranding of Holyheld to Mover
*/
contract MoverToken is ERC20PresetMinterPauserUpgradeable, ERC20PermitUpgradeable {
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
        return "MoverToken";
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20PresetMinterPauserUpgradeable, ERC20Upgradeable) {
        super._beforeTokenTransfer(from, to, amount);
    }

    // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by admin
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
	}

    // airdrop tokens (used to distributed bonus tokens)
	// callable only by admin
	function airdropTokens(address[] calldata _recipients, uint256[] calldata _amounts) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        require(_recipients.length == _amounts.length, "array length mismatch");
		for(uint256 i = 0; i < _recipients.length; i++) {
            _mint(_recipients[i], _amounts[i]);
        }
	}

    // add new variables that can be renamed
    string private _token_name;
    string private _token_symbol;

    function name() public override view returns (string memory) {
        return _token_name;
    }

    function symbol() public override view returns (string memory) {
        return _token_symbol;
    }

    // set the name and symbol for the token
    // callable only by admin
    function setTokenName(string memory _symbol, string memory _name) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        _token_name = _name;
        _token_symbol = _symbol;
        _EIP712SetNameHash(_name);
    }
}
