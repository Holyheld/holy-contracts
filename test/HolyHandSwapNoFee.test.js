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

contract('HolyHand: token swap without fees', function (accounts) {
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

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyHand should swap USDC (1e6 decimals) to DAI (1e18 decimals)', async function() {
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

    // should receive 112500000000000000000 DAI
    const amountExpected = web3.utils.toBN('125000000').mul(web3.utils.toBN('1000000000000')).muln(9).divn(10);

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === this.mockusdc.address &&
               ev.tokenTo.toString() === this.mockdai.address &&
               ev.user.toString() === accounts[3] &&
               ev.amount.toString() === '125000000' &&
               ev.amountReceived.toString() === '112500000000000000000';
        });

    // when no exchange fees, executeSwapDirect produces no event in HolyWing to save gas

    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('50000000');
    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal(amountExpected.toString());    
  });

  it('HolyHand should swap DAI (1e18 decimals) to USDC (1e6 decimals)', async function() {
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

    // should receive 41610888 USDC
    const amountExpected = web3.utils.toBN('46234320000000000000').div(web3.utils.toBN('1000000000000')).muln(9).divn(10);

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === this.mockdai.address &&
               ev.tokenTo.toString() === this.mockusdc.address &&
               ev.user.toString() === accounts[3] &&
               ev.amount.toString() === '46234320000000000000' &&
               ev.amountReceived.toString() === '41610888';
        });

    // when no exchange fees, executeSwapDirect produces no event in HolyWing to save gas

    expect((await this.mockdai.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN('175000000000000000000').sub(web3.utils.toBN('46234320000000000000')).toString());
    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal(amountExpected.toString());    
  });

  it('HolyHand should swap raw ETH (1e18 decimals) to USDC (1e6 decimals)', async function() {
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

    // should receive 41610888 USDC
    const amountExpected = web3.utils.toBN('46234320000000000000').div(web3.utils.toBN('1000000000000')).muln(9).divn(10);

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' &&
               ev.tokenTo.toString() === this.mockusdc.address &&
               ev.user.toString() === accounts[1] &&
               ev.amount.toString() === '46234320000000000000' &&
               ev.amountReceived.toString() === '41610888';
        });

    // when no exchange fees, executeSwapDirect produces no event in HolyWing to save gas
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal(amountExpected.toString());
    expect((await web3.eth.getBalance(accounts[1])).toString().substring(0,5)).to.equal('53760'); // ~53.76 ETH left on account (gas and contract gas cost dependent), TODO: also check string length
    expect((await web3.eth.getBalance(this.holywing.address)).toString()).to.equal('0'); // no ETH on HolyWing
    expect((await web3.eth.getBalance(this.mockexecutor.address)).toString()).to.equal('46234320000000000000'); // 46.23432 ETH on swap executor
  });

  it('HolyHand should swap USDC (1e6 decimals) to ETH (1e18 decimals)', async function() {
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

    // should receive 11250000000000000000 (11.25) Ether
    const amountExpected = web3.utils.toBN('12500000').mul(web3.utils.toBN('1000000000000')).muln(9).divn(10);

    truffleAssert.eventEmitted(innerTx, 'ExecuteSwap', (ev) => {
        return ev.tokenFrom.toString() === this.mockusdc.address &&
               ev.tokenTo.toString() === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' &&
               ev.user.toString() === accounts[3] &&
               ev.amount.toString() === '12500000' &&
               ev.amountReceived.toString() === '11250000000000000000';
        });

    const accountBalance = (await web3.eth.getBalance(accounts[3])).toString();
    expect(accountBalance.substring(0,4)).to.equal('1112'); // ~111.237 ETH left on account (gas and contract gas cost dependent)
    expect(accountBalance.length).to.equal(21); // 111 + 18 decimal digits

    expect((await web3.eth.getBalance(this.holywing.address)).toString()).to.equal('0');
    expect((await web3.eth.getBalance(this.mockexecutor.address)).toString()).to.equal('1000000000000000000'); // 12.25 (executor ETH supply) - 11.25 = 1 eth
    expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal('162500000');
  });

});