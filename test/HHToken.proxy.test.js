// test/HHToken.proxy.test.js
// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

// Load compiled artifacts
const HHToken = artifacts.require('HHTokenV2');
const MoverToken = artifacts.require('MoverToken');

contract('HHToken (proxy)', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.hhtokenold = await deployProxy(HHToken, ["Holyheld", "HH"], { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.hhtoken = await upgradeProxy(this.hhtokenold.address, MoverToken, { unsafeAllowCustomTypes: true });
    await this.hhtoken.setTokenName("MOVE", "Mover");
});

  it('should have proper symbol, name and decimal places set', async function () {
    expect((await this.hhtoken.symbol()).toString()).to.equal('MOVE');
    expect((await this.hhtoken.name()).toString()).to.equal('Mover');
    expect((await this.hhtoken.decimals()).toString()).to.equal('18');
  });

  it('should have balance and circulation amount increased when minted', async function () {
    await this.hhtoken.mint(accounts[1], 1021);
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('1021');
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('1021');
  });

  it('should not be able to mint tokens without role assigned', async function () {
    await truffleAssert.reverts(this.hhtoken.mint(accounts[0], 1021, { from: accounts[1] }), "must have minter role to mint");
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('0');
  });

  it('should be able to grant minter role to other address', async function () {
    const minter_role = await this.hhtoken.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.hhtoken.grantRole(minter_role, accounts[1]);
    await this.hhtoken.mint(accounts[0], 421, { from: accounts[1] });
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('421');
  });

  it('should be able to revoke minter role from other address', async function () {
    const minter_role = await this.hhtoken.MINTER_ROLE();
    await this.hhtoken.grantRole(minter_role, accounts[1]);
    await this.hhtoken.mint(accounts[0], 123, { from: accounts[1] });
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('123');
    await this.hhtoken.revokeRole(minter_role, accounts[1]);
    await truffleAssert.reverts(this.hhtoken.mint(accounts[0], 1021, { from: accounts[1] }), "must have minter role to mint");
  });

  it('should have burn function', async function () {
    await this.hhtoken.mint(accounts[1], 2364, { from: accounts[0] });
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('2364');
    await this.hhtoken.burn(1500, { from: accounts[1] });
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('864');
  });

  it('should have burnFrom function executed with allowance', async function () {
    await this.hhtoken.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('955');
    await this.hhtoken.approve.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
    await this.hhtoken.burnFrom(accounts[1], 900, { from: accounts[2] });
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('55');
  });

  it('should not have burnFrom function executed without allowance', async function () {
    await this.hhtoken.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('955');
    await truffleAssert.reverts(this.hhtoken.burnFrom(accounts[1], 900, { from: accounts[3] }), "burn amount exceeds allowance");
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('955');
  });

  it('should not have burnFrom function executed without sufficient allowance', async function () {
    await this.hhtoken.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('955');
    //await this.hhtoken.approve.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000'), { from: accounts[1] });
    await truffleAssert.reverts(this.hhtoken.burnFrom(accounts[1], 900, { from: accounts[2] }), "burn amount exceeds allowance");
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('955');
  });

  it('should have mass airdrop function', async function () {
    await this.hhtoken.airdropTokens([ accounts[1], accounts[2] ], [ 64, 1024 ], { from: accounts[0] });
    expect((await this.hhtoken.balanceOf(accounts[1])).toString()).to.equal('64');
    expect((await this.hhtoken.balanceOf(accounts[2])).toString()).to.equal('1024');
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('1088');
    await truffleAssert.reverts(this.hhtoken.airdropTokens([ accounts[1] ], [ 123 ], { from: accounts[1] }), "Admin only");
  });
});