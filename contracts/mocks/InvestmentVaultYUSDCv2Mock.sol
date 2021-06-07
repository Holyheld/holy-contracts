// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/IYearnVaultUSDCv2.sol";

// Mock of the vault (from yearn.finance) to test deposit/withdraw/yield harvest locally,
// NOTE: this vault mock keeps 15% in reserve (otherwise 0.5% fee is applied)
contract InvestmentVaultYUSDCv2Mock is ERC20("yUSDCMOCK", "yUSDC"), IYearnVaultUSDCv2 {
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
    function pricePerShare() external override view returns (uint256) {
        //return IERC20(token).balanceOf(address(this)).mul(1e6).div(totalShares);
        return balance.mul(1e6).div(totalShares);
    }

    // deposit USDC and receive lpTokens (shares)
    function deposit(uint _amount, address _recipient) external override returns (uint256) {
        IERC20(token).safeTransferFrom(msg.sender, tokenStash, _amount);
        uint256 sharesToAdd = _amount.mul(1e6).div(this.pricePerShare());
        totalShares = totalShares.add(sharesToAdd);
        shares[_recipient] = shares[_recipient].add(sharesToAdd);
        _mint(_recipient, sharesToAdd);

        balance = balance.add(_amount);
        rebalance();
        return sharesToAdd;
    }
    
    // withdraw amount of shares and return USDC
    function withdraw(uint _shares, address _recipient, uint _maxloss) external override returns (uint256) {
        IERC20(this).safeTransferFrom(msg.sender, BURN_ADDRESS, _shares);

        uint256 amount = this.pricePerShare().mul(_shares).div(1e6);

        if (amount <= IERC20(token).balanceOf(address(this))) {
            // no fee applied
            IERC20(token).safeTransferFrom(tokenStash, _recipient, amount);
            totalShares = totalShares.sub(_shares);
            shares[msg.sender] = shares[msg.sender].sub(_shares);
            balance = balance.sub(amount);
        } else {
            // 0.5% fee applied to portion exceeding safe amount
            uint256 amountWithoutFee = IERC20(token).balanceOf(address(this));
            uint256 amountWithFee = amount.sub(amountWithoutFee);

            // transfer from stash amount with fee deducted
            IERC20(token).safeTransferFrom(tokenStash, _recipient, amountWithoutFee.add(amountWithFee.mul(995).div(1000)));

            totalShares = totalShares.sub(_shares);
            shares[msg.sender] = shares[msg.sender].sub(_shares);
            balance = balance.sub(amount);
            amount = amountWithoutFee.add(amountWithFee.mul(995).div(1000));
        }
        rebalance();
        return amount;
    }

    function availableDepositLimit() external override view returns(uint) {
        return 1000000000000000000;
    }

    function totalAssets() external override view returns(uint) {
        return balance;
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