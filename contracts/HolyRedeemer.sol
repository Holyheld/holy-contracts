// contracts/HolyRedeemer.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/IHolyPool.sol";

/*
	HolyRedeemer is yield distributor

	This contract has no public methods (except getters)

    Note: if user deposits and withdraws funds from a pool with less than any yield was claimed,
    in such case no yield is generated for the user.
    In the future, this contract could be upgraded to provided yield in more continuous fashion.

	HolyRedeemer takes addresses to claim assets from to save on gas cost (and it should be
	executed by automated backend).
	Amount is specified for safety purposes and should match the balance of baseAsset
	on the addresses provided.
	Addresses should set up allowance with appropriate functions beforehand.
	First version of HolyRedeemer does not make any tokens conversion.
	Distribution proportion is modified via specific methods.
	Beneficiaries of yield distribution contain:
	 - HolyPool (as interface to trigger method to update its state) as yield earned by clients;
	 - HolyTreasury (as address, without any particularities of its interface for now) as yield for token holders;
	 - Address to receive funds for operations.
	Earnings are harvested from:
	 - HolyValor balances (yield from investing activities);
	 - HolyHand balance (fees on transfers, swaps, etc.).
	This version of contract has variables and logic preset for above beneficiaries.
*/
contract HolyRedeemer is AccessControlUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // role that grants most of financial operations for HolyRedeemer
    bytes32 public constant FINMGMT_ROLE = keccak256("FINMGMT_ROLE");

	uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

	// percentage values (5000000000000000000 means 5%) of yield that is
	// distributed to HolyTreasury and operational cashflow. Remainder is net
	// customer profit.
	uint256 public percentageTreasury;
	uint256 public percentageOperations;

	address public addressTreasury;
	address public addressOperations;
	address public addressPool;

    event YieldDistributed(address indexed token, uint256 amount);
	event EmergencyTransfer(address indexed token, address indexed destination, uint256 amount);
	event DistributionPercentChanged(string indexed party, address indexed partyAddress, uint256 percentage);

    function initialize() public initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
		_setupRole(FINMGMT_ROLE, _msgSender());

		percentageTreasury = 5000000000000000000;
		percentageOperations = 5000000000000000000;
    }

	function redeemSingleAddress(address _address) public {
		require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");

		IERC20 token = IERC20(IHolyPool(addressPool).getBaseAsset());

		// claim funds to this contract address (HolyPool.harvestYield() would take funds from this contract anyway)
		uint256 yieldAmount = token.balanceOf(_address);
		token.safeTransferFrom(_address, address(this), yieldAmount);

		distributeYield(token, yieldAmount);
	}

	function redeemMultiAddress(address[] memory _addresses) public {
		require(hasRole(FINMGMT_ROLE, msg.sender), "Finmgmt only");
		require(_addresses.length > 0, "parameter is empty array");

		IERC20 token = IERC20(IHolyPool(addressPool).getBaseAsset());
		uint256 totalYield = 0;

		// claim funds to this contract address (HolyPool.harvestYield() would take funds from this contract anyway)
		for(uint i = 0; i < _addresses.length; i++) {
			uint256 yieldAmount = token.balanceOf(_addresses[i]);
			token.safeTransferFrom(_addresses[i], address(this), yieldAmount);
			totalYield = totalYield.add(yieldAmount);
		}

		distributeYield(token, totalYield);
	}

	function distributeYield(IERC20 _token, uint256 _yieldAmount) internal {
		// percentage values representation is 1e18 meaning 1 percent, therefore 1e20 equals 100%
		uint256 amountTreasury = _yieldAmount.mul(percentageTreasury).div(1e20);
		uint256 amountOperations = _yieldAmount.mul(percentageOperations).div(1e20);

		if (amountTreasury > 0 && addressTreasury != address(0)) {
			_token.transfer(addressTreasury, amountTreasury);
		}
		if (amountOperations > 0 && addressOperations != address(0)) {
			_token.transfer(addressOperations, amountOperations);
		}

		uint256 amountPool = _yieldAmount.sub(amountTreasury).sub(amountOperations);
		if (_token.allowance(address(this), addressPool) < amountPool) {
			_token.approve(addressPool, ALLOWANCE_SIZE);
		}

		IHolyPool(addressPool).harvestYield(amountPool);
		emit YieldDistributed(address(_token), _yieldAmount);
	}

	function setPoolAddress(address _addressPool) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        addressPool = _addressPool;
	}

	function setTreasuryAddress(address _addressTreasury) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        addressTreasury = _addressTreasury;
	}

	function setOperationsAddress(address _addressOperations) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        addressOperations = _addressOperations;
	}

	function setTreasuryPercentage(uint256 _percentageTreasury) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		require(_percentageTreasury.add(percentageOperations) <= 1e20, "treasury/ops sum >100 percent");
        percentageTreasury = _percentageTreasury;
        emit DistributionPercentChanged("treasury", addressTreasury, _percentageTreasury);
	}

	function setOperationsPercentage(uint256 _percentageOperations) public {
	    require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		require(_percentageOperations.add(percentageTreasury) <= 1e20, "treasury/ops sum >100 percent");
        percentageOperations = _percentageOperations;
        emit DistributionPercentChanged("operations", addressOperations, _percentageOperations);
	}

    // all contracts that do not hold funds have this emergency function if someone occasionally
	// transfers ERC20 tokens directly to this contract
	// callable only by owner
	function emergencyTransfer(address _token, address _destination, uint256 _amount) public {
		require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
		IERC20(_token).safeTransfer(_destination, _amount);
    	emit EmergencyTransfer(_token, _destination, _amount);
	}
}