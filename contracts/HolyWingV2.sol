// contracts/HolyWingV2.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./interfaces/IHolyWingV2.sol";
import "./utils/SafeAllowanceReset.sol";


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
      (thus does not requiring any allowance calls) for executeSwapDirect or it should have allowance
      if swapping through executeSwap;
   2. This contract is provided with data of how order is going to be routed (bytes swalCallData)
   3. 0x order routing may require that this contract should set allowance to some address to spend
      its tokens;
   4. The address that performs the swap is called with swapdata set;
   5. If swap is successful, this contract transfers tokens directly to beneficiary or
      back to the HolyHand contract;
   6. Appropriate event is emitted with swap details;
   7. Fees (if applicable) are staying on this contract address.
*/
contract HolyWingV2 is
    AccessControlUpgradeable,
    IHolyWingV2,
    SafeAllowanceReset
{
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    function initialize() public initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    /////////////////////////////////////////////////////////////////////////
    // V1 variables
    uint256 private constant ALLOWANCE_SIZE =
        0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    // Payable fallback to allow this contract to receive ETH when swapping to raw ETH and protocol fee refunds.
    receive() external payable {}

    event ExecuteSwap(
        address indexed user,
        address indexed tokenFrom,
        address tokenTo,
        uint256 amount,
        uint256 amountReceived
    );

    event EmergencyTransfer(
        address indexed token,
        address indexed destination,
        uint256 amount
    );

    /////////////////////////////////////////////////////////////////////////
    // V2 variables
    // token address for non-wrapped eth
    address private constant ETH_TOKEN_ADDRESS =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // HolyRedeemer yield distributor
    // NOTE: to keep overhead for users minimal, fees are not transferred
    // immediately, but left on this contract balance, yieldDistributor can reclaim them
    address private yieldDistributorAddress;

    // HolyHand transfer proxy, methods are restricted to it for security reasons (and to allow direct transits to save gas, using single allowance point)
    address private transferProxyAddress;

    fallback() external payable {}

    function slice(
        bytes memory _bytes,
        uint256 _start,
        uint256 _length
    ) internal pure returns (bytes memory) {
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
                    let mc := add(
                        add(tempBytes, lengthmod),
                        mul(0x20, iszero(lengthmod))
                    )
                    let end := add(mc, _length)

                    for {
                        // The multiplication in the next line has the same exact purpose
                        // as the one above.
                        let cc := add(
                            add(
                                add(_bytes, lengthmod),
                                mul(0x20, iszero(lengthmod))
                            ),
                            _start
                        )
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

    function executeSwap(
        address _tokenFrom,
        address _tokenTo,
        uint256 _amount,
        bytes memory _data
    ) public payable override returns (uint256) {
        if (_tokenFrom != ETH_TOKEN_ADDRESS) {
            IERC20(_tokenFrom).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }
        return
            executeSwapDirect(
                msg.sender,
                _tokenFrom,
                _tokenTo,
                _amount,
                0,
                _data
            );
    }

    // data is an arbitrary construction, that can be supplied if swap request is initiated
    // off-chain (it may be required or may be empty, depending on implementation)
    // TODO: WE DON'T TAKE RESPONSIBILITY OF CONTRACT PASSED IN THE DATA SECTION
    //      THAT IS PROVIDED BY 0x INFRASTRUCTURE
    //      -- this contract would perform check for expected minimum amount
    //      -- this contract performs call operation with arbitrary data:
    //         -- no reentrancy;
    //         -- this contract is a layer of security and does not have abilities except swap
    // for current implementation, a 0x.org services are used to perform execution
    // this contract would provice allowance by itself if needed, and tokens to be swapped
    // have to be on its balance before
    // data is unfolded into following structure in current implementation:
    // bytes offset
    // [ 0..19] address to call to perform swap
    // [20..39] allowance target to perform swap
    // [40..61] value of ETH to pass (if we swapping ether)
    // [62...]   data section passed from swap request
    // swap that directly transfers swapped tokens to beneficiary, and amounts should be present on this contract
    // this contract should contain only exchange fees (if enabled) other funds are tranferred within single transaction
    function executeSwapDirect(
        address _beneficiary,
        address _tokenFrom,
        address _tokenTo,
        uint256 _amount,
        uint256 _exchangeFee,
        bytes memory _data
    ) public payable override returns (uint256) {
        require(msg.sender == transferProxyAddress, "transfer proxy only");

        address executorAddress;
        address spenderAddress;
        uint256 ethValue;

        bytes memory callData = slice(_data, 72, _data.length - 72);
        assembly {
            executorAddress := mload(add(_data, add(0x14, 0)))
            spenderAddress := mload(add(_data, add(0x14, 0x14)))
            ethValue := mload(add(_data, add(0x20, 0x28)))
        }

        // allow spender to transfer tokens from this contract
        if (_tokenFrom != ETH_TOKEN_ADDRESS && spenderAddress != address(0)) {
            resetAllowanceIfNeeded(IERC20(_tokenFrom), spenderAddress, _amount);
        }

        uint256 balanceBefore = 0;
        if (_tokenTo != ETH_TOKEN_ADDRESS) {
            balanceBefore = IERC20(_tokenTo).balanceOf(address(this));
        } else {
            balanceBefore = address(this).balance;
        }

        // regardless of stated amount, the ETH value passed to exchange call must be provided to the contract
        require(msg.value >= ethValue, "insufficient ETH provided");

        // ensure no state passed, no reentrancy, etc.
        (bool success, ) = executorAddress.call{value: ethValue}(callData);
        require(success, "SWAP_CALL_FAILED");

        // always rely only on actual amount received regardless of called parameters
        uint256 amountReceived = 0;
        if (_tokenTo != ETH_TOKEN_ADDRESS) {
            amountReceived = IERC20(_tokenTo).balanceOf(address(this));
        } else {
            amountReceived = address(this).balance;
        }
        amountReceived = amountReceived.sub(balanceBefore);

        require(amountReceived > 0, "zero amount received");

        // process exchange fee if present (in deposit we get pool tokens, so process fees after swap, here we take fees in source token)
        // fees are left on this contract address and are harvested by yield distributor
        //uint256 feeAmount = amountReceived.mul(_exchangeFee).div(1e18);
        amountReceived = amountReceived.sub(
            amountReceived.mul(_exchangeFee).div(1e18)
        ); // this is return value that should reflect actual result of swap (for deposit, etc.)

        if (_tokenTo != ETH_TOKEN_ADDRESS) {
            //send received tokens to beneficiary directly
            IERC20(_tokenTo).safeTransfer(_beneficiary, amountReceived);
        } else {
            //send received eth to beneficiary directly
            payable(_beneficiary).sendValue(amountReceived);
            // payable(_beneficiary).transfer(amountReceived);
            // should work for external wallets (currently is the case)
            // but wont work for some other smart contracts due to gas stipend limit
        }

        emit ExecuteSwap(
            _beneficiary,
            _tokenFrom,
            _tokenTo,
            _amount,
            amountReceived
        );
        return amountReceived;
    }

    // swap calls are restricted only to HolyHand transfer proxy, which is set using this method
    function setTransferProxy(address _transferProxyAddress) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        transferProxyAddress = _transferProxyAddress;
    }

    // to save gas costs during withdrawals, etc, yield harvested (and it should be only yield)
    // is stored on this contract balance. Yield distributor contract should have permission
    // to get tokens from this contract
    function setYieldDistributor(
        address _tokenAddress,
        address _distributorAddress
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        yieldDistributorAddress = _distributorAddress;
        // only yield to be redistributed should be present on this contract in baseAsset (or other tokens if swap fees)
        // so no access to lp tokens for the funds invested
        resetAllowanceIfNeeded(
            IERC20(_tokenAddress),
            _distributorAddress,
            ALLOWANCE_SIZE
        );
    }

    // this function is similar to emergencyTransfer, but relates to yield distribution
    // fees are not transferred immediately to save gas costs for user operations
    // so they accumulate on this contract address and can be claimed by HolyRedeemer
    // when appropriate. Anyway, no user funds should appear on this contract, it
    // only performs transfers, so such function has great power, but should be safe
    // It does not include approval, so may be used by HolyRedeemer to get fees from swaps
    // in different small token amounts
    function claimFees(address _token, uint256 _amount) public {
        require(
            msg.sender == yieldDistributorAddress,
            "yield distributor only"
        );
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransfer(msg.sender, _amount);
        } else {
            payable(msg.sender).sendValue(_amount);
        }
    }

    // all contracts that do not hold funds have this emergency function if someone occasionally
    // transfers ERC20 tokens directly to this contract
    // callable only by owner
    function emergencyTransfer(
        address _token,
        address _destination,
        uint256 _amount
    ) public {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin only");
        if (_token != ETH_TOKEN_ADDRESS) {
            IERC20(_token).safeTransfer(_destination, _amount);
        } else {
            payable(_destination).sendValue(_amount);
        }
        emit EmergencyTransfer(_token, _destination, _amount);
    }
}
