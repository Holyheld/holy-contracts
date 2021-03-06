// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/IYearnVaultUSDC.sol";

// Mock of the vault (from yearn.finance) to test deposit/withdraw/yield harvest locally,
// NOTE: this vault mock keeps 15% in reserve (otherwise 0.5% fee is applied)
contract InvestmentVaultYUSDCMock is ERC20("yUSDCMOCK", "yUSDC"), IYearnVaultUSDC {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

	address private constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    address public override token;
    address public tokenStash;

    uint256 public totalShares;
    mapping(address => uint256) shares;

    uint256 public balance;

    // tokenStash should hold token amount and have allowance so vault mock get them as yield when needed
    constructor(address _token) public {
        token = _token;

        totalShares = 1e6;
        balance = 1e6;
     
        _setupDecimals(6);
    }

    // returns price of 1 lpToken (share) in amount of base asset (USDC)
    function getPricePerFullShare() external override view returns (uint256) {
        //return IERC20(token).balanceOf(address(this)).mul(1e18).div(totalShares);
        return balance.mul(1e18).div(totalShares);
    }
    
    // returns amount (of base asset, USDC) that is available to borrow (not used)
    function available() external override view returns (uint256) {
        return IERC20(token).balanceOf(address(this)).mul(15).div(100);
    }

    // deposit USDC and receive lpTokens (shares)
    function deposit(uint _amount) external override {
        IERC20(token).safeTransferFrom(msg.sender, tokenStash, _amount);
        uint256 sharesToAdd = _amount.mul(1e18).div(this.getPricePerFullShare());
        totalShares = totalShares.add(sharesToAdd);
        shares[msg.sender] = shares[msg.sender].add(sharesToAdd);
        _mint(msg.sender, sharesToAdd);

        balance = balance.add(_amount);
        rebalance();
    }
    
    // withdraw amount of shares and return USDC
    function withdraw(uint _shares) external override {
        IERC20(this).safeTransferFrom(msg.sender, BURN_ADDRESS, _shares);

        uint256 amount = this.getPricePerFullShare().mul(_shares).div(1e18);

        if (amount <= IERC20(token).balanceOf(address(this))) {
            // no fee applied
            IERC20(token).safeTransferFrom(tokenStash, msg.sender, amount);
            totalShares = totalShares.sub(_shares);
            shares[msg.sender] = shares[msg.sender].sub(_shares);
            balance = balance.sub(amount);
        } else {
            // 0.5% fee applied to portion exceeding safe amount
            uint256 amountWithoutFee = IERC20(token).balanceOf(address(this));
            uint256 amountWithFee = amount.sub(amountWithoutFee);

            // transfer from stash amount with fee deducted
            IERC20(token).safeTransferFrom(tokenStash, msg.sender, amountWithoutFee.add(amountWithFee.mul(995).div(1000)));

            totalShares = totalShares.sub(_shares);
            shares[msg.sender] = shares[msg.sender].sub(_shares);
            balance = balance.sub(amount);
        }
        rebalance();
    }

    function earnProfit(uint _amount) public {
        balance = balance.add(_amount);
        IERC20(token).safeTransferFrom(tokenStash, address(this), _amount);
    }

    // leave 15% of balance of token on this contract, place other to stash
    function rebalance() internal {
        // transfer all tokens to stash address
        if (IERC20(token).balanceOf(address(this)) > 0) { 
            IERC20(token).transfer(tokenStash, IERC20(token).balanceOf(address(this)));
        }
        // get 15% of expected balance from stash address
        if (IERC20(token).balanceOf(tokenStash) >= balance) {
            IERC20(token).safeTransferFrom(tokenStash, address(this), balance.mul(15).div(100));
        } else {
            revert("not enough tokens in stash");
        }
    }

    function setStash(address _stash) public {
        tokenStash = _stash;
        rebalance();
    }
}