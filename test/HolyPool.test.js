// test/HolyPool.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HolyHand = artifacts.require('HolyHandV2');
const HolyPool = artifacts.require('HolyPoolV2');
const HolyWing = artifacts.require('HolyWingV2');
const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockTokenSwapExecutorMock = artifacts.require('TokenSwapExecutorMock');

contract('HolyPool (deposit and withdraw scenarios)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    this.holywing = await deployProxy(HolyWing, { unsafeAllowCustomTypes: true, from: accounts[0] });

    this.holyhand = await deployProxy(HolyHand, { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.holyhand.setExchangeProxy.sendTransaction(this.holywing.address, { from: accounts[0] });
    await this.holywing.setTransferProxy(this.holyhand.address);

    // deploy exchange (swap) related mocks
    this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });
    this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });

    // deploy pool and connect HolyPool to transfer proxy
    this.holypool = await deployProxy(HolyPool, [ this.mockusdc.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.holypool.setTransferProxy.sendTransaction(this.holyhand.address, { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyHand should directly deposit tokens for user to HolyPool', async function() {
    // approve HolyHand transfer proxy to spend DAI
    await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });
    
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('1000000000000');

    const txDeposit = await this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('19300000000'), web3.utils.toBN('0'), []);
    const innerTxPool = await truffleAssert.createTransactionResult(this.holypool, txDeposit.tx);

    truffleAssert.eventEmitted(innerTxPool, 'Deposit', (ev) => {
      return ev.account.toString() === accounts[0] &&
             ev.amount.toString() === '19300000000';
    });

    // transfer the rest of USDC to another account
    await this.mockusdc.transfer(accounts[1], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // verify that deposited amount is correct and received
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('19300000000');

    // test partial withdraw
    await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('10500000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('10500000000');
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('8800000000');
  });

  it('HolyHand should exchange tokens through HolyWing and perform deposit for user to HolyPool (no fees)', async function() {

    // transfer all USDC mock balance to swap executor
    await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });

    // approve HolyHand transfer proxy to spend DAI
    await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });
    
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');

    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
                        web3.utils.hexToBytes(this.mockexecutor.address), // spender address
                        web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
                        web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
                        web3.utils.hexToBytes(this.mockdai.address),
                        web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
                        web3.utils.hexToBytes(this.mockusdc.address),
                        web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000054B40B1F852BDA00000'));

    await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockdai.address, web3.utils.toBN('25000000000000000000000'), web3.utils.toBN('25000000000000000000000'), bytesData), "minimum swap amount not met");
    const txDeposit = await this.holyhand.depositToPool(this.holypool.address, this.mockdai.address, web3.utils.toBN('25000000000000000000000'), web3.utils.toBN('22000000000'), bytesData);
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txDeposit.tx);
    const innerTxPool = await truffleAssert.createTransactionResult(this.holypool, txDeposit.tx);

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
      return ev.user.toString() === this.holypool.address &&
             ev.tokenFrom.toString() === this.mockdai.address &&
             ev.tokenTo.toString() === this.mockusdc.address &&
             ev.amount.toString() === '25000000000000000000000' &&
             ev.amountReceived.toString() === '22500000000';
    });

    truffleAssert.eventEmitted(innerTxPool, 'Deposit', (ev) => {
      return ev.account.toString() === accounts[0] &&
             ev.amount.toString() === '22500000000';
    });

    // verify that deposited amount is correct and received
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('22500000000');

    await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('22500000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('22500000000');
  });

  it('HolyHand should be able to process fees when set (deposit/withdraw)', async function() {
    // approve HolyHand transfer proxy to spend DAI
    await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });
    
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('1000000000000');

    // enable fees and set accounts[5] as fee receiver
    await this.holyhand.setYieldDistributor(this.mockusdc.address, accounts[5], { from: accounts[0] });
    await this.holyhand.setDepositFee(web3.utils.toBN('20000000000000000'), { from: accounts[0] }); // 0.02 (2%) deposit fee
    await this.holyhand.setWithdrawFee(web3.utils.toBN('30000000000000000'), { from: accounts[0] }); // 0.03 (3%) withdraw fee

    const txDeposit = await this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('20000000000'), web3.utils.toBN('0'), []);

    // transfer the rest of USDC to another account
    await this.mockusdc.transfer(accounts[1], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // verify that deposited amount is correct and received
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('19600000000'); // 20000 * 0.98 = 19600

    // test partial withdraw
    await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('10000000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('9700000000'); // 10000 * 0.97 = 9700
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('9600000000');

    // balance on HolyHand should be equal to fees collected
    expect((await this.mockusdc.balanceOf(this.holyhand.address)).toString()).to.equal('700000000');

    await truffleAssert.reverts(this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[0] }), "yield distributor only");

    // yield distributor should be able to claim fees
    this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[5] });
    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('700000000');
  });

  it('HolyHand should be able to process fees when set (deposit/exchange/withdraw) (DAI)', async function() {
    // approve HolyHand transfer proxy to spend DAI
    await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });
    
    // transfer all USDC mock balance to swap executor
    await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });

    expect((await this.mockdai.balanceOf(accounts[0])).toString()).to.equal('1000000000000000000000000');

    // enable fees and set accounts[5] as fee receiver
    await this.holyhand.setYieldDistributor(this.mockusdc.address, accounts[5], { from: accounts[0] });
    await this.holyhand.setDepositFee(web3.utils.toBN('20000000000000000'), { from: accounts[0] }); // 0.02 (2%) deposit fee
    await this.holyhand.setWithdrawFee(web3.utils.toBN('30000000000000000'), { from: accounts[0] }); // 0.03 (3%) withdraw fee
    await this.holyhand.setExchangeFee(web3.utils.toBN('40000000000000000'), { from: accounts[0] }); // 0.01 (1%) exchange fee
    await this.holywing.setYieldDistributor(this.mockusdc.address, accounts[5], { from: accounts[0] });

    // swap amount of 75000000000000000000 DAI = 0x4847B7925D28D5555
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes(this.mockdai.address),
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x000000000000000000000000000000000000000000000004847B7925D28D5555'));

    const txDeposit = await this.holyhand.depositToPool(this.holypool.address, this.mockdai.address, web3.utils.toBN('83333333333333333333'), web3.utils.toBN('7000000'), bytesData);
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txDeposit.tx);
    const innerTxPool = await truffleAssert.createTransactionResult(this.holypool, txDeposit.tx);

    // should receive 83.333 333 333 333 333 333 DAI (0.9 swap rate) 7500000 96% (-4% exchange fee) 72000000 (-2% deposit fee) 70560000
    const swapFeeExpected = web3.utils.toBN('83333333333333333333').div(web3.utils.toBN('1000000000000')).muln(9).divn(10).muln(4).divn(100);
    const amountAfterSwapExpected = web3.utils.toBN('83333333333333333333').div(web3.utils.toBN('1000000000000')).muln(9).divn(10).sub(swapFeeExpected); //72000000
    const depositFeeExpected = amountAfterSwapExpected.muln(2).divn(100);
    const amountExpected = amountAfterSwapExpected.sub(depositFeeExpected); // 70560000

    // HolyWing event
    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
      return ev.tokenFrom.toString() === this.mockdai.address &&
             ev.tokenTo.toString() === this.mockusdc.address &&
             ev.user.toString() === this.holyhand.address && // holyhand will deduct deposit fee, so not holypool directly
             ev.amount.toString() === '83333333333333333333' &&
             ev.amountReceived.toString() === '72000000';
      });

    truffleAssert.eventEmitted(innerTxPool, 'Deposit', (ev) => {
        return ev.account.toString() === accounts[0] &&
               ev.amount.toString() === amountExpected.toString();
      });

    // transfer the rest of USDC to another account
    await this.mockusdc.transfer(accounts[1], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // verify that deposited amount is correct and received
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal(amountExpected.toString()); // 70560000

    // test partial withdraw
    await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('10000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('9700000'); // 10000000 * 0.97 = 9700000
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('60560000');

    // balance on HolyWing should be equal to exchange fees collected (3000000)
    expect((await this.mockusdc.balanceOf(this.holywing.address)).toString()).to.equal('2999999');
    // balance on HolyHand should be equal to deposit + withdraw fees collected (1440000 + 300000 = 1740000)
    expect((await this.mockusdc.balanceOf(this.holyhand.address)).toString()).to.equal('1740000');

    await truffleAssert.reverts(this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[0] }), "yield distributor only");
    await truffleAssert.reverts(this.holywing.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[0] }), "yield distributor only");

    // yield distributor should be able to claim fees
    this.holywing.claimFees(this.mockusdc.address, web3.utils.toBN('2999999'), { from: accounts[5] });
    this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('1740000'), { from: accounts[5] });

    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('4739999');
  });

  it('HolyHand should be able to process fees when set (deposit/exchange/withdraw) (ETH)', async function() {
    // approve HolyHand transfer proxy to spend DAI
    await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });
    
    // transfer all USDC mock balance to swap executor
    await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });

    expect((await this.mockdai.balanceOf(accounts[0])).toString()).to.equal('1000000000000000000000000');

    // enable fees and set accounts[5] as fee receiver
    await this.holyhand.setYieldDistributor(this.mockusdc.address, accounts[5], { from: accounts[0] });
    await this.holyhand.setDepositFee(web3.utils.toBN('20000000000000000'), { from: accounts[0] }); // 0.02 (2%) deposit fee
    await this.holyhand.setWithdrawFee(web3.utils.toBN('30000000000000000'), { from: accounts[0] }); // 0.03 (3%) withdraw fee
    await this.holyhand.setExchangeFee(web3.utils.toBN('40000000000000000'), { from: accounts[0] }); // 0.01 (1%) exchange fee
    await this.holywing.setYieldDistributor(this.mockusdc.address, accounts[5], { from: accounts[0] });

    // swap amount of 83333333333333333333 ETH = 0x4847B7925D28D5555
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x000000000000000000000000000000000000000000000004847B7925D28D5555'), 
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'),
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x000000000000000000000000000000000000000000000004847B7925D28D5555'));

    const txDeposit = await this.holyhand.depositToPool(this.holypool.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', web3.utils.toBN('83333333333333333333'), web3.utils.toBN('7000000'), bytesData, { value: web3.utils.toBN('83333333333333333333') });
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txDeposit.tx);
    const innerTxPool = await truffleAssert.createTransactionResult(this.holypool, txDeposit.tx);

    // should receive 83.333 333 333 333 333 333 ETH (0.9 swap rate) 7500000 96% (-4% exchange fee) 72000000 (-2% deposit fee) 70560000
    const swapFeeExpected = web3.utils.toBN('83333333333333333333').div(web3.utils.toBN('1000000000000')).muln(9).divn(10).muln(4).divn(100);
    const amountAfterSwapExpected = web3.utils.toBN('83333333333333333333').div(web3.utils.toBN('1000000000000')).muln(9).divn(10).sub(swapFeeExpected); //72000000
    const depositFeeExpected = amountAfterSwapExpected.muln(2).divn(100);
    const amountExpected = amountAfterSwapExpected.sub(depositFeeExpected); // 70560000

    // HolyWing event
    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
      return ev.tokenFrom.toString() === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' &&
             ev.tokenTo.toString() === this.mockusdc.address &&
             ev.user.toString() === this.holyhand.address && // holyhand will deduct deposit fee, so not holypool directly
             ev.amount.toString() === '83333333333333333333' &&
             ev.amountReceived.toString() === '72000000';
      });

    truffleAssert.eventEmitted(innerTxPool, 'Deposit', (ev) => {
        return ev.account.toString() === accounts[0] &&
               ev.amount.toString() === amountExpected.toString();
      });

    // transfer the rest of USDC to another account
    await this.mockusdc.transfer(accounts[1], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // verify that deposited amount is correct and received
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal(amountExpected.toString()); // 70560000

    // test partial withdraw
    await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('10000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('9700000'); // 10000000 * 0.97 = 9700000
    expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('60560000');

    // balance on HolyWing should be equal to exchange fees collected (3000000)
    expect((await this.mockusdc.balanceOf(this.holywing.address)).toString()).to.equal('2999999');
    // balance on HolyHand should be equal to deposit + withdraw fees collected (1440000 + 300000 = 1740000)
    expect((await this.mockusdc.balanceOf(this.holyhand.address)).toString()).to.equal('1740000');

    await truffleAssert.reverts(this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[0] }), "yield distributor only");
    await truffleAssert.reverts(this.holywing.claimFees(this.mockusdc.address, web3.utils.toBN('700000000'), { from: accounts[0] }), "yield distributor only");

    // yield distributor should be able to claim fees
    this.holywing.claimFees(this.mockusdc.address, web3.utils.toBN('2999999'), { from: accounts[5] });
    this.holyhand.claimFees(this.mockusdc.address, web3.utils.toBN('1740000'), { from: accounts[5] });

    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('4739999');
  });
});