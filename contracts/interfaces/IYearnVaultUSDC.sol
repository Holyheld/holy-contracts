// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to yearn.finance USDC v1 vault
interface IYearnVaultUSDC {
    // returns base asset address (USDC)
    function token() external view returns (address);

    // returns price of 1 lpToken (share) in amount of base asset (USDC)
    function getPricePerFullShare() external view returns (uint);
    // returns amount (of base asset, USDC) that is safe to borrow (not used)
    function available() external view returns (uint);
    // returns amount (of base asset, USDC) that is available in vault plus controller (not used)
    // function balance() external view returns (uint);

    // deposit USDC and receive lpTokens (shares)
    function deposit(uint _amount) external;
    // withdraw amount of shares and return USDC
    function withdraw(uint _shares) external;
}

