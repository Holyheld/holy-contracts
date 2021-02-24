// test/HolyPassageMigration.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HHToken = artifacts.require('HHToken');
const HolyToken = artifacts.require('HolyToken');
const HolyPassageV2 = artifacts.require('HolyPassageV4');
const MockUSDC = artifacts.require('ERC20USDCMock');

contract('HolyPassage (emergency transfer)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    // account 1 is v1 HOLY token owner
    // account 2 is v1 treasury
    this.holytoken = await HolyToken.new(accounts[1], accounts[2], { from: accounts[0] });
    this.hhtoken = await deployProxy(HHToken, ["Holyheld Token", "HH"], { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.holypassage = await deployProxy(HolyPassageV2, [this.holytoken.address, this.hhtoken.address], { unsafeAllowCustomTypes: true, from: accounts[0] });

    // Grant minter role to the HolyPassage contract
    const minter_role = await this.hhtoken.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.hhtoken.grantRole(minter_role, this.holypassage.address);

    // Enable migration
    await this.holypassage.setMigrationEnabled(true, { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();
  });

  it('should be able to do emergencyTransfer tokens from its balance', async function () {
    // transfer some USDC tokens (by mistake) to this contract address
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    await this.mockusdc.transfer(this.holypassage.address, web3.utils.toBN('53516345'));

    expect((await this.mockusdc.balanceOf(this.holypassage.address)).toString()).to.equal('53516345');

    await truffleAssert.reverts(this.holypassage.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('53516345'), { from: accounts[2] }), "Admin only");
    await this.holypassage.emergencyTransfer(this.mockusdc.address, accounts[5], web3.utils.toBN('53516345'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.holypassage.address)).toString()).to.equal('0');
    expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('53516345');
  });
});