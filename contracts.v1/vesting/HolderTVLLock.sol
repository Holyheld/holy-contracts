// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev A token holder contract that will allow a beneficiary to extract the
 * tokens by portions based on a metric (TVL)
 *
 * This is ported from openzeppelin-ethereum-package
 *
 * Currently the holder contract is Ownable (while the owner is current beneficiary)
 * still, this allows to check the method calls in blockchain to verify fair play.
 * In the future it will be possible to use automated calculation, e.g. using
 * https://github.com/ConcourseOpen/DeFi-Pulse-Adapters TVL calculation, then
 * ownership would be transferred to the managing contract.
 */
contract HolderTVLLock is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 private constant RELEASE_PERCENT = 2;
    uint256 private constant RELEASE_INTERVAL = 1 weeks;

    // ERC20 basic token contract being held
    IERC20 private _token;

    // beneficiary of tokens after they are released
    address private _beneficiary;

    // timestamp when token release was made last time
    uint256 private _lastReleaseTime;

    // timestamp of first possible release time
    uint256 private _firstReleaseTime;

    // TVL metric for last release time
    uint256 private _lastReleaseTVL;

    // amount that already was released
    uint256 private _released;

    event TVLReleasePerformed(uint256 newTVL);

    constructor (IERC20 token, address beneficiary, uint256 firstReleaseTime) public {
        //as contract is deployed by Holyheld token, transfer ownership to dev
        transferOwnership(beneficiary);

        // solhint-disable-next-line not-rely-on-time
        require(firstReleaseTime > block.timestamp, "release time before current time");
        _token = token;
        _beneficiary = beneficiary;
        _firstReleaseTime = firstReleaseTime;
    }

    /**
     * @return the token being held.
     */
    function token() public view returns (IERC20) {
        return _token;
    }

    /**
     * @return the beneficiary of the tokens.
     */
    function beneficiary() public view returns (address) {
        return _beneficiary;
    }

    /**
     * @return the time when the tokens were released last time.
     */
    function lastReleaseTime() public view returns (uint256) {
        return _lastReleaseTime;
    }

    /**
     * @return the TVL marked when the tokens were released last time.
     */
    function lastReleaseTVL() public view returns (uint256) {
        return _lastReleaseTVL;
    }

    /**
     * @notice Transfers tokens held by timelock to beneficiary.
     * only owner can call this method as it will write new TVL metric value
     * into the holder contract
     */
    function release(uint256 _newTVL) public onlyOwner {
        // solhint-disable-next-line not-rely-on-time
        require(block.timestamp >= _firstReleaseTime, "current time before release time");
        require(block.timestamp > _lastReleaseTime + RELEASE_INTERVAL, "release interval is not passed");
        require(_newTVL > _lastReleaseTVL, "only release if TVL is higher");

        // calculate amount that is possible to release
        uint256 balance = _token.balanceOf(address(this));
        uint256 totalBalance = balance.add(_released);

        uint256 amount = totalBalance.mul(RELEASE_PERCENT).div(100);
        require(balance > amount, "available balance depleted");

        _token.safeTransfer(_beneficiary, amount);
	    _lastReleaseTime = block.timestamp;
	    _lastReleaseTVL = _newTVL;
	    _released = _released.add(amount);

        emit TVLReleasePerformed(_newTVL);
    }
}