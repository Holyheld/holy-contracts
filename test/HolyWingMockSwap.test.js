// test/HolyWingMockSwap.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HolyWing = artifacts.require('HolyWingV2');
const HolyWingDebug = artifacts.require('HolyWingDebug');
const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockTokenSwapExecutorMock = artifacts.require('TokenSwapExecutorMock');

contract('HolyWing (mocked token swap scenarios)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    this.holywing = await deployProxy(HolyWing, { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.holywing.setTransferProxy(accounts[0]);

    this.holywingdebug = await deployProxy(HolyWingDebug, { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  // set 1 marked static data to check bounds correctness
  it('should properly slice swap execution call data bytes (set 1)', async function () {
    const bytesData = web3.utils.asciiToHex('AAAAAAAAAAAAAAAAAAAAVVVVVVVVVVVVVVVVVVVVBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBCCCCCCCCDDDDDDDDDDDDDDDD');
    const txSwap = await this.holywingdebug.executeSwapTest(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('1000000000000000000000'), web3.utils.toBN('9900000000000000000000'), bytesData)

    truffleAssert.eventEmitted(txSwap, 'ExecuteSwapDebug', (ev) => {
        //console.log("Swap call data debug event, execAddress:" + ev.swapExecutor.toString() + ", ethValue:" + ev.ethValue.toString() + ", callData:" + ev.callData.toString())
        return ev.swapExecutor.toString() === '0x4141414141414141414141414141414141414141' &&
               ev.allowanceTarget.toString() === '0x5656565656565656565656565656565656565656' &&
               ev.ethValue.toString() === '29969717214364191756688960825778046738493407795812851869036080566753986495042' &&
               ev.callData.toString() === '0x434343434343434344444444444444444444444444444444';
    });
  });

  // set 2 with address, value and calldata close to real values
  it('should properly slice swap execution call data bytes (set 2)', async function () {
    const bytesData = [].concat(web3.utils.hexToBytes('0x8041c679f7Fd37758E4c19D0B7e355014fBCbdfe'), web3.utils.hexToBytes('0x8041c679f7Fd37758E4c19D0B7e355014fBCbdfe'), web3.utils.hexToBytes(web3.utils.asciiToHex('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBCCCCCCCCDDDDDDDDDDDDDDDD')));
    const txSwap = await this.holywingdebug.executeSwapTest(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('1000000000000000000000'), web3.utils.toBN('9900000000000000000000'), bytesData)

    truffleAssert.eventEmitted(txSwap, 'ExecuteSwapDebug', (ev) => {
        //console.log("Swap call data debug event, execAddress:" + ev.swapExecutor.toString() + ", ethValue:" + ev.ethValue.toString() + ", callData:" + ev.callData.toString())
        return ev.swapExecutor.toString() === '0x8041c679f7Fd37758E4c19D0B7e355014fBCbdfe' &&
               ev.allowanceTarget.toString() === '0x8041c679f7Fd37758E4c19D0B7e355014fBCbdfe' && 
               ev.ethValue.toString() === '29969717214364191756688960825778046738493407795812851869036080566753986495042' &&
               ev.callData.toString() === '0x434343434343434344444444444444444444444444444444';
    });
  });


  it('should execute swap producing exchange of tokens (test contract HolyWingDebug)', async function() {
    this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });

    //function is swapTokens(address _tokenFrom, address _tokenTo, uint256 _amount)
    // swap 25000 DAI for 22500 USDC (mocked)
    await this.mockdai.approve.sendTransaction(this.holywingdebug.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });

    // transfer all USDC mock balance to swap executor
    await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');

    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), web3.utils.hexToBytes(this.mockexecutor.address), 
                        web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
                        web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), //func hash + padding for address of token from
                        web3.utils.hexToBytes(this.mockdai.address),
                        web3.utils.hexToBytes('0x000000000000000000000000'), //padding for address of token to
                        web3.utils.hexToBytes(this.mockusdc.address),
                        web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000054B40B1F852BDA00000'));

    const txSwap = await this.holywingdebug.executeSwap(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('25000000000000000000000'), bytesData);

    const callData = [].concat(web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), //func hash + padding for address of token from
                        web3.utils.hexToBytes(this.mockdai.address),
                        web3.utils.hexToBytes('0x000000000000000000000000'), //padding for address of token to
                        web3.utils.hexToBytes(this.mockusdc.address),
                        web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000054B40B1F852BDA00000'));

    truffleAssert.eventEmitted(txSwap, 'ExecuteSwapDebug', (ev) => {
        return ev.swapExecutor.toString() === this.mockexecutor.address &&
               ev.allowanceTarget.toString() === this.mockexecutor.address &&
               ev.ethValue.toString() === '0' &&
               ev.callData.toString() === web3.utils.bytesToHex(callData).toString();
    });

    truffleAssert.eventEmitted(txSwap, 'ExecuteSwap', (ev) => {
      return ev.user.toString() === accounts[0] &&
             ev.tokenFrom.toString() === this.mockdai.address &&
             ev.tokenTo.toString() === this.mockusdc.address &&
             ev.amount.toString() === '25000000000000000000000' &&
             ev.amountReceived.toString() === '22500000000';
    });

    // verify that amounts are correct and received
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('22500000000');
  });

  it('should execute swap producing exchange of tokens (real contract)', async function() {
    this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });

    //function is swapTokens(address _tokenFrom, address _tokenTo, uint256 _amount)
    // swap 25000 DAI for 22500 USDC (mocked)
    await this.mockdai.approve.sendTransaction(this.holywing.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[0] });

    // transfer all USDC mock balance to swap executor
    await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');

    const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), web3.utils.hexToBytes(this.mockexecutor.address), 
                        web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
                        web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), //func hash + padding for address of token from
                        web3.utils.hexToBytes(this.mockdai.address),
                        web3.utils.hexToBytes('0x000000000000000000000000'), //padding for address of token to
                        web3.utils.hexToBytes(this.mockusdc.address),
                        web3.utils.hexToBytes('0x00000000000000000000000000000000000000000000054B40B1F852BDA00000'));

    const txSwap = await this.holywing.executeSwap(this.mockdai.address, this.mockusdc.address, web3.utils.toBN('25000000000000000000000'), bytesData);

    truffleAssert.eventEmitted(txSwap, 'ExecuteSwap', (ev) => {
        return ev.user.toString() === accounts[0] &&
               ev.tokenFrom.toString() === this.mockdai.address &&
               ev.tokenTo.toString() === this.mockusdc.address &&
               ev.amount.toString() === '25000000000000000000000' &&
               ev.amountReceived.toString() === '22500000000';
    });

    // verify that amounts are correct and received
    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('22500000000');
  });
});