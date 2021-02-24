// test/HHTokenEmergency.test.js
// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
//const web3 = require('web3');

// Load compiled artifacts
const HHToken = artifacts.require('HHToken');
const MockUSDC = artifacts.require('ERC20USDCMock');

contract('HHToken (emergency transfer)', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.hhtoken = await deployProxy(HHToken, ["Holyheld Token", "HH"], { unsafeAllowCustomTypes: true, from: accounts[0] });
  });

  it('should be able to do emergencyTransfer tokens from its balance', async function () {
    // transfer some USDC tokens (by mistake) to this contract address
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    await this.mockusdc.transfer(this.hhtoken.address, web3.utils.toBN('1456830'));

    expect((await this.mockusdc.balanceOf(this.hhtoken.address)).toString()).to.equal('1456830');

    await truffleAssert.reverts(this.hhtoken.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('1456830'), { from: accounts[2] }), "Admin only");
    await this.hhtoken.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('1456830'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.hhtoken.address)).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('1456830');
  });
});