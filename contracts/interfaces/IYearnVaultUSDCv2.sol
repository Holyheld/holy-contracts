// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to yearn.finance USDC v1 vault
interface IYearnVaultUSDCv2 {
    // returns base asset address (USDC)
    function token() external view returns (address);

    // returns price of 1 lpToken (share) in amount of base asset (USDC)
    function pricePerShare() external view returns (uint);

    // available deposit limit for the vault
    function availableDepositLimit() external view returns (uint);

    // deposit USDC and receive lpTokens (shares)
    //    Measuring quantity of shares to issues is based on the total
    //    outstanding debt that this contract has ("expected value") instead
    //    of the total balance sheet it has ("estimated value") has important
    //    security considerations, and is done intentionally. If this value were
    //    measured against external systems, it could be purposely manipulated by
    //    an attacker to withdraw more assets than they otherwise should be able
    //    to claim by redeeming their shares.
    //
    //    On deposit, this means that shares are issued against the total amount
    //    that the deposited capital can be given in service of the debt that
    //    Strategies assume. If that number were to be lower than the "expected
    //    value" at some future point, depositing shares via this method could
    //    entitle the depositor to *less* than the deposited value once the
    //    "realized value" is updated from further reports by the Strategies
    //    to the Vaults.
    //
    //    Care should be taken by integrators to account for this discrepancy,
    //    by using the view-only methods of this contract (both off-chain and
    //    on-chain) to determine if depositing into the Vault is a "good idea".
    //  returns quantity of shares issued for _amount
    function deposit(uint _amount, address _recipient) external returns (uint);

    // withdraw amount of shares and return USDC
    //  maxloss is maximum loss in bps (1 = 0.01%)
    //  returns quantity of tokens redeemed for _shares.
    function withdraw(uint _shares, address _recipient, uint _maxloss) external returns (uint);

    // total base asset amount in the vault or under strategies
    function totalAssets() external view returns (uint);
}
