// test/HolyVisor.test.js
// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
//const web3 = require('web3');

// Load compiled artifacts
const HolyVisor = artifacts.require('HolyVisorV3');
const MockUSDC = artifacts.require('ERC20USDCMock');

contract('HolyVisor (emergency transfer)', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.holyvisor = await deployProxy(HolyVisor, [], { unsafeAllowCustomTypes: true, from: accounts[0] });
  });

  it('should be able to do emergencyTransfer tokens from its balance', async function () {
    // transfer some USDC tokens (by mistake) to this contract address
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    await this.mockusdc.transfer(this.holyvisor.address, web3.utils.toBN('4235324'));

    expect((await this.mockusdc.balanceOf(this.holyvisor.address)).toString()).to.equal('4235324');

    await truffleAssert.reverts(this.holyvisor.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('4235324'), { from: accounts[2] }), "Admin only");
    await this.holyvisor.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('4235324'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.holyvisor.address)).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('4235324');
  });
});