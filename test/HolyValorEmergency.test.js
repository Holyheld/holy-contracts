// test/HolyValorEmergency.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

//const web3 = require('web3');

// Load compiled artifacts
const HolyValor = artifacts.require('HolyValorYearnUSDCVaultV2');
const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const HolyPool = artifacts.require('HolyPool');
const YUSDCPoolMock = artifacts.require('InvestmentVaultYUSDCMock');


contract('HolyValor (emergency transfer timelock)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    // deploy exchange ERC20 mocks to reporesent assets
    this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });

    this.yusdcvault = await YUSDCPoolMock.new(this.mockusdc.address, { from: accounts[0] });
    await this.mockusdc.approve.sendTransaction(this.yusdcvault.address, web3.utils.toBN('1000000000000000000'), { from: accounts[9] });
    await this.mockusdc.transfer(accounts[9], web3.utils.toBN('500000000000'), { from: accounts[0] });
    await this.yusdcvault.setStash(accounts[9]);

    this.holypool = await deployProxy(HolyPool, [ this.mockusdc.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });

    // deploy HolyValor
    this.holyvalor = await deployProxy(HolyValor, [ this.mockusdc.address, this.yusdcvault.address, this.holypool.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });

    // transfer all USDC to HolyValor directly
    await this.mockusdc.transfer(this.holyvalor.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyValor should not allow to withdraw tokens even to admin', async function() {
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');

    await truffleAssert.reverts(this.mockusdc.transferFrom(this.holyvalor.address, accounts[0], web3.utils.toBN('25000000000'), { from: accounts[0] }), "transfer amount exceeds allowance");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');
  });

  it('HolyValor should allow for admin to create emergency transfer request and execute after 24hrs', async function() {
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');

    await truffleAssert.reverts(this.holyvalor.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('27000000000'), { from: accounts[1] }), "Admin only");
    const txLockSet = await this.holyvalor.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('24000000000'), { from: accounts[0] });

    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[1] }), "Admin only");
    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[0] }), "timelock too early");

    await time.increase(25 * 3600);
    const txLockExecute = await this.holyvalor.emergencyTransferExecute({ from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('24000000000');
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('476000000000');

    truffleAssert.eventEmitted(txLockSet, 'EmergencyTransferSet', (ev) => {
        return ev.token === this.mockusdc.address && ev.destination === accounts[0] && ev.amount.toString() === '24000000000';
    });

    truffleAssert.eventEmitted(txLockExecute, 'EmergencyTransferExecute', (ev) => {
        return ev.token === this.mockusdc.address && ev.destination === accounts[0] && ev.amount.toString() === '24000000000';
    });
  });

  it('HolyValor should not allow to execute timelock after 72h', async function() {
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');

    await this.holyvalor.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('25000000000'), { from: accounts[0] });

    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[1] }), "Admin only");
    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[0] }), "timelock too early");

    await time.increase(80 * 3600);
    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[0] }), "timelock too late");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');
  });

  it('HolyValor executing empty timelock should revert (too late as timestamp is 0)', async function() {
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');

    await time.increase(80 * 3600);
    await truffleAssert.reverts(this.holyvalor.emergencyTransferExecute({ from: accounts[0] }), "timelock too late");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('500000000000');
  });
});