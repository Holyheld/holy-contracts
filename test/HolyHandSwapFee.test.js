// test/HolyHandSwap.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HolyHand = artifacts.require('HolyHandV2');
const HolyWing = artifacts.require('HolyWingV2');

const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockTokenSwapExecutorMock = artifacts.require('TokenSwapExecutorMock');

contract('HolyHand: token swap with 4% exchange fee', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address

    // deploy exchange ERC20 mocks to represent assets
    this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });

    // deploy HolyWing
    this.holywing = await deployProxy(HolyWing, { unsafeAllowCustomTypes: true, from: accounts[0] });

    // deploy HolyHand
    this.holyhand = await deployProxy(HolyHand, { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.holyhand.setExchangeProxy.sendTransaction(this.holywing.address, { from: accounts[0] });
    await this.holywing.setTransferProxy.sendTransaction(this.holyhand.address, { from: accounts[0] });

    await this.holyhand.setDepositFee(web3.utils.toBN('20000000000000000'), { from: accounts[0] });  // 2%
    await this.holyhand.setWithdrawFee(web3.utils.toBN('30000000000000000'), { from: accounts[0] }); // 3%
    await this.holyhand.setExchangeFee(web3.utils.toBN('40000000000000000'), { from: accounts[0] }); // 4%

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyHand should swap USDC (1e6 decimals) to DAI (1e18 decimals) (with 4% exchange fee)', async function() {
    // transfer DAI to exchange executor
    await this.mockdai.transfer(this.mockexecutor.address, await this.mockdai.balanceOf(accounts[0]), { from: accounts[0] });
    await this.mockusdc.transfer(accounts[3], web3.utils.toBN('175000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('175000000');
    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal('0');

    // approve for HolyHand to spend USDC
    await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[3] });
    await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[2] });

    // swap amount of 125000000 USDC = 0x7735940
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes(this.mockdai.address),
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000007735940'));

    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockusdc.address, this.mockdai.address, web3.utils.toBN('125000000'), web3.utils.toBN('200000000000000000000'), bytesData, { from: accounts[3] }), "minimum swap amount not met");
    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockusdc.address, this.mockdai.address, web3.utils.toBN('125000000'), web3.utils.toBN('100000000000000000000'), bytesData, { from: accounts[2] }), "transfer amount exceeds balance");
    const txSwap = await this.holyhand.executeSwap(this.mockusdc.address, this.mockdai.address, web3.utils.toBN('125000000'), web3.utils.toBN('100000000000000000000'), bytesData, { from: accounts[3] });
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txSwap.tx);

    // should receive 112500000000000000000 DAI (1080000 after 4% fee)
    const amountExpected = web3.utils.toBN('125000000').mul(web3.utils.toBN('1000000000000')).muln(96).divn(100).muln(9).divn(10);
    const feeExpected = web3.utils.toBN('125000000').mul(web3.utils.toBN('1000000000000')).muln(4).divn(100).muln(9).divn(10);

    // HolyWing event
    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
      return ev.tokenFrom.toString() === this.mockusdc.address &&
             ev.tokenTo.toString() === this.mockdai.address &&
             ev.user.toString() === accounts[3] &&
             ev.amount.toString() === '125000000' &&
             ev.amountReceived.toString() === '108000000000000000000';
      });

    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('50000000');
    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal(amountExpected.toString());

    // fees should be left on HolyWing address (in swapped token)
    expect((await this.mockdai.balanceOf(this.holywing.address)).toString()).to.equal(feeExpected.toString());
  });

  it('HolyHand should swap DAI (1e18 decimals) to USDC (1e6 decimals) (with 4% exchange fee)', async function() {
    // transfer DAI to exchange executor
    await this.mockusdc.transfer(this.mockexecutor.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });
    await this.mockdai.transfer(accounts[3], web3.utils.toBN('175000000000000000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal('175000000000000000000');

    // approve for HolyHand to spend DAI
    await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[3] });
    await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[2] });

    // swap amount of 46234320000000000000 DAI = 0x281A14D147FBD0000
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes(this.mockdai.address),
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000000281A14D147FBD0000'));

    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('50000000'), bytesData, { from: accounts[3] }), "minimum swap amount not met");
    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('38000000'), bytesData, { from: accounts[2] }), "transfer amount exceeds balance");
    const txSwap = await this.holyhand.executeSwap(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('38000000'), bytesData, { from: accounts[3] });
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txSwap.tx);

    // should receive 41610888 USDC * 96% (-4% fee) 39946453
    const feeExpected = web3.utils.toBN('46234320000000000000').muln(4).divn(100).muln(9).divn(10).div(web3.utils.toBN('1000000000000'));

    // HolyWing event
    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
      return ev.tokenFrom.toString() === this.mockdai.address &&
             ev.tokenTo.toString() === this.mockusdc.address &&
             ev.user.toString() === accounts[3] &&
             ev.amount.toString() === '46234320000000000000' &&
             ev.amountReceived.toString() === '39946453';
      });

    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN('175000000000000000000').sub(web3.utils.toBN('46234320000000000000')).toString());
    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('39946453');

    // fees should be left on HolyHand address (in swapped token)
    expect((await this.mockusdc.balanceOf(this.holywing.address)).toString()).to.equal(feeExpected.toString());
  });

  it('HolyHand should swap raw ETH (1e18 decimals) to USDC (1e6 decimals) (with 4% exchange fee)', async function() {
    await this.mockusdc.transfer(this.mockexecutor.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('0');
    expect((await web3.eth.getBalance(accounts[1])).toString()).to.equal('100000000000000000000'); // 100 ETH

    // swap amount of 46234320000000000000 ETH = 0x281A14D147FBD0000
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000000281A14D147FBD0000'), // ether value 46234320000000000000 in hex
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'), // ETH address
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000000281A14D147FBD0000'));

    // inner revert base of call with insufficient ETH provided
    await truffleAssert.reverts(this.holyhand.executeSwap.sendTransaction('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('38000000'), bytesData, { value: web3.utils.toBN('1250000000000000'), from: accounts[1] }), "insufficient ETH provided");
    // expecting too much USDC in return
    await truffleAssert.reverts(this.holyhand.executeSwap.sendTransaction('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('50000000'), bytesData, { value: web3.utils.toBN('46234320000000000000'), from: accounts[1] }), "minimum swap amount not met");
    
    const txSwap = await this.holyhand.executeSwap.sendTransaction('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', this.mockusdc.address, web3.utils.toBN('46234320000000000000'), web3.utils.toBN('38000000'), bytesData, { value: web3.utils.toBN('46234320000000000000'), from: accounts[1] });
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txSwap.tx);

    // should receive 41610888 USDC - 4% fee 39946452
    const feeExpected = web3.utils.toBN('46234320000000000000').muln(9).divn(10).div(web3.utils.toBN('1000000000000')).muln(4).divn(100);
    const amountExpected = web3.utils.toBN('46234320000000000000').muln(9).divn(10).div(web3.utils.toBN('1000000000000')).sub(feeExpected); //39946453

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' &&
               ev.tokenTo.toString() === this.mockusdc.address &&
               ev.user.toString() === accounts[1] &&
               ev.amount.toString() === '46234320000000000000' &&
               ev.amountReceived.toString() === amountExpected.toString();
        });

    // when no exchange fees, executeSwapDirect produces no event in HolyWing to save gas
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal(amountExpected.toString());
    expect((await this.mockusdc.balanceOf(this.holywing.address)).toString()).to.equal(feeExpected.toString());
    expect((await web3.eth.getBalance(accounts[1])).toString().substring(0,5)).to.equal('53759'); // ~53.759 ETH left on account (gas and contract gas cost dependent), TODO: also check string length
    expect((await web3.eth.getBalance(this.holywing.address)).toString()).to.equal('0'); // no ETH on HolyWing
    expect((await web3.eth.getBalance(this.mockexecutor.address)).toString()).to.equal('46234320000000000000'); // 46.23432 ETH on swap executor
  });

  it('HolyHand should swap USDC (1e6 decimals) to ETH (1e18 decimals) (with 4% exchange fee)', async function() {
    // transfer ETH to exchange executor
    await this.mockexecutor.sendTransaction({ value: web3.utils.toBN('12250000000000000000'), from: accounts[0] });
    expect((await web3.eth.getBalance(this.mockexecutor.address)).toString()).to.equal('12250000000000000000');
    // transfer USDC balance to accountp performing swap
    await this.mockusdc.transfer(accounts[3], web3.utils.toBN('175000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('175000000');

    // approve for HolyHand to spend USDC
    await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[3] });

    // swap amount of 125000000 USDC = 0x7735940
    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), 
            web3.utils.hexToBytes(this.mockexecutor.address), // spender address
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), // func hash + padding for address of token from
            web3.utils.hexToBytes(this.mockusdc.address),
            web3.utils.hexToBytes('0x000000000000000000000000'), // padding for address of token to
            web3.utils.hexToBytes('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'),
            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000BEBC20'));

    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockusdc.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', web3.utils.toBN('12500000'), web3.utils.toBN('200000000000000000000'), bytesData, { from: accounts[3] }), "minimum swap amount not met");
    await truffleAssert.reverts(this.holyhand.executeSwap(this.mockusdc.address, this.mockdai.address, web3.utils.toBN('625000000000'), web3.utils.toBN('100000000000000000000'), bytesData, { from: accounts[3] }), "transfer amount exceeds balance");
    const txSwap = await this.holyhand.executeSwap(this.mockusdc.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', web3.utils.toBN('12500000'), web3.utils.toBN('10000000000000000000'), bytesData, { from: accounts[3] });
    const innerTx = await truffleAssert.createTransactionResult(this.holywing, txSwap.tx);

    // should receive 11250000000000000000 (11.25) Ether -4% exchange fee = 10800000000000000000
    const feeExpected = web3.utils.toBN('12500000').mul(web3.utils.toBN('1000000000000')).muln(9).divn(10).muln(4).divn(100);
    const amountExpected = web3.utils.toBN('12500000').mul(web3.utils.toBN('1000000000000')).muln(9).divn(10).sub(feeExpected); // 10800000000000000000

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === this.mockusdc.address &&
               ev.tokenTo.toString() === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' &&
               ev.user.toString() === accounts[3] &&
               ev.amount.toString() === '12500000' &&
               ev.amountReceived.toString() === amountExpected.toString();
        });

    const accountBalance = (await web3.eth.getBalance(accounts[3])).toString();
    expect(accountBalance.substring(0,4)).to.equal('1107'); // ~110.7 ETH left on account (gas and contract gas cost dependent)
    expect(accountBalance.length).to.equal(21); // 110 + 18 decimal digits

    expect((await web3.eth.getBalance(this.holywing.address)).toString()).to.equal(feeExpected.toString());
    expect((await web3.eth.getBalance(this.mockexecutor.address)).toString()).to.equal('1000000000000000000'); // 12.25 (executor ETH supply) - 11.25 = 1 eth
    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('162500000');
  });
});