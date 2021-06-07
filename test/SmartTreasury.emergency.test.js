// test/SmartTreasury.emergency.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

const SmartTreasury = artifacts.require('SmartTreasury');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');

contract('SmartTreasury (emergency transfer timelock)', function (accounts) {
  beforeEach(async function () {
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mover = await MoverToken.new(accounts[0], { from: accounts[0] });
    // mock of DAI suits us (18 decimals) as simple ERC20 token
    this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.st = await deployProxy(SmartTreasury, ["SmartTreasury", "STB", this.mockusdc.address, this.mover.address, this.movelpmock.address], { unsafeAllowCustomTypes: true, from: accounts[0] });

    // transfer all USDC to ST directly
    await this.mockusdc.transfer(this.st.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('should not allow to withdraw tokens even to admin', async function() {
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');

    await truffleAssert.reverts(this.mockusdc.transferFrom(this.st.address, accounts[0], web3.utils.toBN('25000000000')), "transfer amount exceeds allowance");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');
  });

  it('should allow for admin to create emergency transfer request and execute after 24hrs', async function() {
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');

    await truffleAssert.reverts(this.st.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('25000000000'), { from: accounts[1] }), "admin only");
    const txLockSet = await this.st.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('25000000000'), { from: accounts[0] });

    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[1] }), "admin only");
    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[0] }), "timelock too early");

    await time.increase(25 * 3600);
    const txLockExecute = await this.st.emergencyTransferExecute({ from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('25000000000');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('975000000000');

    truffleAssert.eventEmitted(txLockSet, 'EmergencyTransferSet', (ev) => {
        return ev.token === this.mockusdc.address && ev.destination === accounts[0] && ev.amount.toString() === '25000000000';
    });

    truffleAssert.eventEmitted(txLockExecute, 'EmergencyTransferExecute', (ev) => {
        return ev.token === this.mockusdc.address && ev.destination === accounts[0] && ev.amount.toString() === '25000000000';
    });
  });

  it('should not allow to execute timelock after 72h', async function() {
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');

    await this.st.emergencyTransferTimelockSet(this.mockusdc.address, accounts[0], web3.utils.toBN('25000000000'), { from: accounts[0] });

    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[1] }), "admin only");
    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[0] }), "timelock too early");

    await time.increase(80 * 3600);
    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[0] }), "timelock too late");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');
  });

  it('executing empty timelock should revert (too late as timestamp is 0)', async function() {
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');

    await time.increase(80 * 3600);
    await truffleAssert.reverts(this.st.emergencyTransferExecute({ from: accounts[0] }), "timelock too late");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000000000000');
  });
});