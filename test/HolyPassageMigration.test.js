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

contract('HolyPassage (token migration scenarios)', function (accounts) {
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

  it('should prohibit migration outside migration window', async function () {
    // founder originally had 1M initial liquidity of HOLY, so use it for tests
    const founder_balance = await this.holytoken.balanceOf(accounts[1]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1000000000000000000000000');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
    expect((await this.holytoken.allowance(accounts[1], this.holypassage.address, { from: accounts[1] })).toString()).to.equal('1000000000000000000000000');

    // perform migration, should fail
    await truffleAssert.reverts(this.holypassage.migrate({ from: accounts[1] }), "time not in migration window");
  });

  it('should provide migration of tokens returning equal amount of HH tokens (no multipliers/HolyVisor attached)', async function () {
    const startTime = (await time.latest()).add(time.duration.days(1));
    const endTime = startTime.add(time.duration.weeks(1));
    await this.holypassage.setMigrationWindow(startTime, endTime);
    await time.increaseTo(startTime.add(time.duration.hours(1)));

    // founder originally had 1M initial liquidity of HOLY, so use it for tests
    const founder_balance = await this.holytoken.balanceOf(accounts[1]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1000000000000000000000000');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
    expect((await this.holytoken.allowance(accounts[1], this.holypassage.address, { from: accounts[1] })).toString()).to.equal('1000000000000000000000000');

    // perform migration
    await this.holypassage.migrate({ from: accounts[1] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[1])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1000000000000000000000000');
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000000');
  });
});