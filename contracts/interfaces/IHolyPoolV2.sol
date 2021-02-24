// SPDX-License-Identifier: MIT

pragma solidity ^0.6.0;

// Interface to represent asset pool interactions
interface IHolyPoolV2 {
    function getBaseAsset() external view returns(address);

    // functions callable by HolyHand transfer proxy
    function depositOnBehalf(address beneficiary, uint256 amount) external;
    function depositOnBehalfDirect(address beneficiary, uint256 amount) external;
    function withdraw(address beneficiary, uint256 amount) external;

    // functions callable by HolyValor investment proxies
    // pool would transfer funds to HolyValor (returns actual amount, could be less than asked)
    function borrowToInvest(uint256 amount) external returns(uint256);
    // return invested body portion from HolyValor (pool will claim base assets from caller Valor)
    function returnInvested(uint256 amountCapitalBody) external;

    // functions callable by HolyRedeemer yield distributor
    function harvestYield(uint256 amount) external; // pool would transfer amount tokens from caller as it's profits
}
