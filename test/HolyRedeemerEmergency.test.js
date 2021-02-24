// test/HolyHandEmergency.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

//const web3 = require('web3');

// Load compiled artifacts
const HolyRedeemer = artifacts.require('HolyRedeemer');
const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');

contract('HolyRedeemer (emergency transfer)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    // deploy exchange ERC20 mocks to reporesent assets
    this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });

    // deploy HolyRedeemer
    this.holyredeemer = await deployProxy(HolyRedeemer, { unsafeAllowCustomTypes: true, from: accounts[0] });

    // transfer all USDC to HolyRedeemer directly
    await this.mockusdc.transfer(this.holyredeemer.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });
    await this.mockdai.transfer(this.holyredeemer.address, await this.mockdai.balanceOf(accounts[0]), { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('HolyRedeemer should not allow to withdraw tokens directly to anyone or without admin role', async function() {
    expect((await this.mockusdc.balanceOf(this.holyredeemer.address)).toString()).to.equal('1000000000000');

    await truffleAssert.reverts(this.mockusdc.transferFrom(this.holyredeemer.address, accounts[0], web3.utils.toBN('25000000000')), "transfer amount exceeds allowance");
    await truffleAssert.reverts(this.holyredeemer.emergencyTransfer(this.mockusdc.address, accounts[3], web3.utils.toBN('25000000000'), { from: accounts[3] }), "Admin only");

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(this.holyredeemer.address)).toString()).to.equal('1000000000000');
  });

  it('HolyRedeemer should allow to withdraw tokens with admin role', async function() {
    expect((await this.mockusdc.balanceOf(this.holyredeemer.address)).toString()).to.equal('1000000000000');

    await truffleAssert.reverts(this.mockusdc.transferFrom(this.holyredeemer.address, accounts[0], web3.utils.toBN('25000000000')), "transfer amount exceeds allowance");
    const txusdc = await this.holyredeemer.emergencyTransfer(this.mockusdc.address, accounts[0], web3.utils.toBN('78100000000'), { from: accounts[0] });
    const txdai = await this.holyredeemer.emergencyTransfer(this.mockdai.address, accounts[2], web3.utils.toBN('1240000000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('78100000000');
    expect((await this.mockdai.balanceOf(accounts[2])).toString()).to.equal('1240000000');
    expect((await this.mockusdc.balanceOf(this.holyredeemer.address)).toString()).to.equal('921900000000');
    expect((await this.mockdai.balanceOf(this.holyredeemer.address)).toString()).to.equal('999999999999998760000000');

    truffleAssert.eventEmitted(txusdc, 'EmergencyTransfer', (ev) => {
        return ev.token === this.mockusdc.address && ev.destination === accounts[0] && ev.amount.toString() === '78100000000';
    });

    truffleAssert.eventEmitted(txdai, 'EmergencyTransfer', (ev) => {
        return ev.token === this.mockdai.address && ev.destination === accounts[2] && ev.amount.toString() === '1240000000';
    });
  });
});