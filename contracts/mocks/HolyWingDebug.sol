// contracts/MyContract.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/*
   HolyWing is a middleware contract that acts as an abstraction layer for tokens exchange
   (ERC20 tokens and ETH)

   The current implementation is using 0x API for performing actual swap, as 0x is aiming for
   best execution, there's no complex logic for now regarding that.
   The contract is not intended to gather fees, be called by users, it is called by the HolyHand,
   which is aimed to do that. This contract is attached to a HolyHand, and has permission to
   create allowance for arbitrary token it would need access to.
   Both of HolyWing and HolyHand contracts do not hold funds, all operations are performed within
   single transaction.

   Exchange occurs in the following steps:
   1. This contract is provided with amount of tokens on its address directly by HolyHand
      (thus does not requiring any allowance calls)
   2. This contract is provided with data of how order is going to be routed (bytes swalCallData)
   3. 0x order routing may require that this contract should set allowance to some address to spend
      its tokens;
   4. The address that performs the swap is called with swapdata set;
   5. If swap is successful, this contract transfers tokens back to the HolyHand contract
      (as well as remaining ETH value if any fee refunds occur, etc.)
   6. Appropriate event is emitted with swap details;
*/
contract HolyWingDebug is AccessControlUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function initialize() public initializer {
            _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    uint256 private constant ALLOWANCE_SIZE = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    // Payable fallback to allow this contract to receive protocol fee refunds.
    receive() external payable {}

    event ExecuteSwap(address indexed user, address indexed tokenFrom, address tokenTo, uint256 amount, uint256 amountReceived);
    event ExecuteSwapDebug(address indexed swapExecutor, address indexed allowanceTarget, uint256 ethValue, bytes callData);

    event EmergencyTransfer(address indexed token, address indexed destination, uint256 amount);

    function slice(
        bytes memory _bytes,
        uint256 _start,
        uint256 _length
    )
        internal
        pure
        returns (bytes memory)
    {
        require(_length + 31 >= _length, "slice_overflow");
        require(_start + _length >= _start, "slice_overflow");
        require(_bytes.length >= _start + _length, "slice_outOfBounds");

        bytes memory tempBytes;

        assembly {
            switch iszero(_length)
            case 0 {
                // Get a location of some free memory and store it in tempBytes as
                // Solidity does for memory variables.
                tempBytes := mload(0x40)

                // The first word of the slice result is potentially a partial
                // word read from the original array. To read it, we calculate
                // the length of that partial word and start copying that many
                // bytes into the array. The first word we copy will start with
                // data we don't care about, but the last `lengthmod` bytes will
                // land at the beginning of the contents of the new array. When
                // we're done copying, we overwrite the full first word with
                // the actual length of the slice.
                let lengthmod := and(_length, 31)

                // The multiplication in the next line is necessary
                // because when slicing multiples of 32 bytes (lengthmod == 0)
                // the following copy loop was copying the origin's length
                // and then ending prematurely not copying everything it should.
                let mc := add(add(tempBytes, lengthmod), mul(0x20, iszero(lengthmod)))
                let end := add(mc, _length)

                for {
                    // The multiplication in the next line has the same exact purpose
                    // as the one above.
                    let cc := add(add(add(_bytes, lengthmod), mul(0x20, iszero(lengthmod))), _start)
                } lt(mc, end) {
                    mc := add(mc, 0x20)
                    cc := add(cc, 0x20)
                } {
                    mstore(mc, mload(cc))
                }

                mstore(tempBytes, _length)

                //update free-memory pointer
                //allocating the array padded to 32 bytes like the compiler does now
                mstore(0x40, and(add(mc, 31), not(31)))
            }
            //if we want a zero-length slice let's just return a zero-length array
            default {
                tempBytes := mload(0x40)
                //zero out the 32 bytes slice we are about to return
                //we need to do it because Solidity does not garbage collect
                mstore(tempBytes, 0)

                mstore(0x40, add(tempBytes, 0x20))
            }
        }

        return tempBytes;
    }

    // data is an arbitrary construction, that can be supplied if swap request is initiated
    // off-chain (it may be required or may be empty, depending on implementation)
    // TODO: WE DON'T TAKE RESPONSIBILITY OF CONTRACT PASSED IN THE DATA SECTION
    //      THAT IS PROVIDED BY 0x INFRASTRUCTURE
    //      -- this contract would perform check for expected minimum amount
    //      -- this contract performs call operation with arbitrary data:
    //         -- no reentrancy;
    //         -- this contract is a layer of security and does not have abilities except swap
    function executeSwap(address _tokenFrom, address _tokenTo, uint256 _amount, bytes memory _data) public returns(uint256) {
        // for current implementation, a 0x.org services are used to perform execution
        // this contract would provice allowance by itself if needed, and tokens to be swapped
        // have to be on its balance before
        // data is unfolded into following structure in current implementation:
        // bytes offset
        // [ 0..19] address to call to perform swap
        // [20..39] allowance target to perform swap
        // [40..61] value of ETH to pass (if we swapping ether)
        // [62...]   data section passed from swap request

        address executorAddress;
        address spenderAddress;
        uint256 ethValue;

        bytes memory callData = slice(_data, 72, _data.length - 72);
        assembly {
            executorAddress := mload(add(_data, add(0x14, 0)))
            spenderAddress := mload(add(_data, add(0x14, 0x14)))
            ethValue := mload(add(_data, add(0x20, 0x28)))
        }

        //allowances should be taken care of beforehand
        //don't perform check to save gas        
        IERC20(_tokenFrom).safeTransferFrom(msg.sender, address(this), _amount);

        if (spenderAddress != address(0) && IERC20(_tokenFrom).allowance(address(this), address(spenderAddress)) < _amount) {
            IERC20(_tokenFrom).approve(address(spenderAddress), ALLOWANCE_SIZE);
        }

        uint balanceBefore = IERC20(_tokenTo).balanceOf(address(this));
        
        //ensure no state passed, no reentrancy, etc.
        (bool success,) = executorAddress.call{value: ethValue}(callData);
        require(success, "SWAP_CALL_FAILED");
        
        emit ExecuteSwapDebug(executorAddress, spenderAddress, ethValue, callData);

        uint balanceAfter = IERC20(_tokenTo).balanceOf(address(this));

        //TODO: failsafe checks on swap, expected minimum amount check (that should be transferred upon swap execution)
        uint256 amountReceived = balanceAfter - balanceBefore;

        //TODO: emit event
        emit ExecuteSwap(msg.sender, _tokenFrom, _tokenTo, _amount, amountReceived);
    
        //send swapped tokens to sender
        IERC20(_tokenTo).safeTransfer(msg.sender, amountReceived);

        return amountReceived;
    }

    function executeSwapTest(address _tokenFrom, address _tokenTo, uint256 _amount, uint256 _expectedMinimumReceived, bytes memory _data) public returns(uint256) {
        address executorAddress;
        address spenderAddress;
        uint256 ethValue;

        bytes memory callData = slice(_data, 72, _data.length - 72);
        assembly {
            executorAddress := mload(add(_data, add(0x14, 0)))
            spenderAddress := mload(add(_data, add(0x14, 0x14)))
            ethValue := mload(add(_data, add(0x20, 0x28)))
        }
        emit ExecuteSwapDebug(executorAddress, spenderAddress, ethValue, callData);
        return 0;
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
