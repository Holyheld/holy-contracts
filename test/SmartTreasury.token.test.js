// test/SmartTreasury.token.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');

const SmartTreasury = artifacts.require('SmartTreasury');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');


contract('SmartTreasury (token)', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mover = await MoverToken.new(accounts[0], { from: accounts[0] });
    // mock of DAI suits us (18 decimals) as simple ERC20 token
    this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.st = await deployProxy(SmartTreasury, ["SmartTreasury", "STB", this.mockusdc.address, this.mover.address, this.movelpmock.address], { unsafeAllowCustomTypes: true, from: accounts[0] });
    await this.st.setTokenName("MOBO", "Mover Bonus");
  });

  it('should have proper symbol, name and decimal places set', async function () {
    expect((await this.st.symbol()).toString()).to.equal('MOBO');
    expect((await this.st.name()).toString()).to.equal('Mover Bonus');
    expect((await this.st.decimals()).toString()).to.equal('6');
  });

  it('should have balance and circulation amount increased when minted', async function () {
    await this.st.mint(accounts[1], 1021);
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1021');
    expect((await this.st.totalSupply()).toString()).to.equal('1021');
  });

  it('should not be able to mint tokens without role assigned', async function () {
    await truffleAssert.reverts(this.st.mint(accounts[0], 1021, { from: accounts[1] }), "must have minter role to mint");
    expect((await this.st.totalSupply()).toString()).to.equal('0');
  });

  it('should be able to grant minter role to other address', async function () {
    const minter_role = await this.st.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.st.grantRole(minter_role, accounts[1]);
    await this.st.mint(accounts[0], 421, { from: accounts[1] });
    expect((await this.st.totalSupply()).toString()).to.equal('421');
  });

  it('should be able to revoke minter role from other address', async function () {
    const minter_role = await this.st.MINTER_ROLE();
    await this.st.grantRole(minter_role, accounts[1]);
    await this.st.mint(accounts[0], 123, { from: accounts[1] });
    expect((await this.st.totalSupply()).toString()).to.equal('123');
    await this.st.revokeRole(minter_role, accounts[1]);
    await truffleAssert.reverts(this.st.mint(accounts[0], 1021, { from: accounts[1] }), "must have minter role to mint");
  });

  it('should have burn function', async function () {
    await this.st.mint(accounts[1], 2364, { from: accounts[0] });
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('2364');
    await this.st.burn(1500, { from: accounts[1] });
    expect((await this.st.totalSupply()).toString()).to.equal('864');
  });

  it('should have burnFrom function executed with allowance', async function () {
    await this.st.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('955');
    await this.st.approve.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
    await this.st.burnFrom(accounts[1], 900, { from: accounts[2] });
    expect((await this.st.totalSupply()).toString()).to.equal('55');
  });

  it('should not have burnFrom function executed without allowance', async function () {
    await this.st.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('955');
    await truffleAssert.reverts(this.st.burnFrom(accounts[1], 900, { from: accounts[3] }), "burn amount exceeds allowance");
    expect((await this.st.totalSupply()).toString()).to.equal('955');
  });

  it('should not have burnFrom function executed without sufficient allowance', async function () {
    await this.st.mint(accounts[1], 955, { from: accounts[0] });
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('955');
    //await this.hhtoken.approve.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000'), { from: accounts[1] });
    await truffleAssert.reverts(this.st.burnFrom(accounts[1], 900, { from: accounts[2] }), "burn amount exceeds allowance");
    expect((await this.st.totalSupply()).toString()).to.equal('955');
  });

  it('should have mass airdrop function', async function () {
    await this.st.airdropTokens([ accounts[1], accounts[2] ], [ 64, 1024 ], { from: accounts[0] });
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('64');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('1024');
    expect((await this.st.totalSupply()).toString()).to.equal('1088');
    await truffleAssert.reverts(this.st.airdropTokens([ accounts[1] ], [ 123 ], { from: accounts[1] }), "admin only");
  });
});