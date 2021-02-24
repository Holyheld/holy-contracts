// test/HolyPassageMultipliers.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HHToken = artifacts.require('HHToken');
const HolyToken = artifacts.require('HolyToken');
const HolyPassageV2 = artifacts.require('HolyPassageV4');
const HolyVisor = artifacts.require('HolyVisor');

contract('HolyPassage/HolyVisor (migration and bonus claim scenarios)', function (accounts) {
  beforeEach(async function () {
    // account 0 is deployer address
    // account 1 is v1 HOLY token owner
    // account 2 is v1 treasury
    this.holytoken = await HolyToken.new(accounts[1], accounts[2], { from: accounts[0] });
    this.hhtoken = await deployProxy(HHToken, ["Holyheld Token", "HH"], { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.holypassage = await deployProxy(HolyPassageV2, [this.holytoken.address, this.hhtoken.address], { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.holyvisor = await deployProxy(HolyVisor, { unsafeAllowCustomTypes: true, from: accounts[0] });

    // Grant minter role to the HolyPassage contract
    const minter_role = await this.hhtoken.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.hhtoken.grantRole(minter_role, this.holypassage.address);

    // Attach HolyVisor data contract
    await this.holypassage.setHolyVisor(this.holyvisor.address, { from: accounts[0] });

    // Enable migration
    await this.holypassage.setMigrationEnabled(true, { from: accounts[0] });

    // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
    await time.advanceBlock();

    // Set active migration time window
    const startTime = (await time.latest()).add(time.duration.days(1));
    const endTime = startTime.add(time.duration.weeks(1));
    await this.holypassage.setMigrationWindow(startTime, endTime);
    await time.increaseTo(startTime.add(time.duration.hours(1)));
  });

  // test if no data populated in HolyVisor
  it('should work even without HolyVisor data contract populated', async function () {
    // migrate from account 3, transfer balance from account 1
    await this.holytoken.transfer(accounts[3], web3.utils.toBN('1375352000000000000001'), { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');
    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal('1375352000000000000001');
  });

  // test if bonus is available for user but not unlocked
  it('should not give bonus if bonuses are available for user, but not unlocked', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('1375352000000000000001'); //1375.32
    const totalBonuses = web3.utils.toBN('541375352000000000000001');
    const userMultiplier = web3.utils.toBN('2150000000000000000'); // 2.15x avg bonus
    const userBonusCap = web3.utils.toBN('3500000000000000000000'); //3500 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');
    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal('1375352000000000000001');
  });

  // test if bonus is available and unlocked during migration
  it('should give bonus if bonuses are available for user and unlocked', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('1375352000000000000001'); // 1375.352
    const totalBonuses = web3.utils.toBN('541375352000000000000001'); // 541375
    const userMultiplier = web3.utils.toBN('2150000000000000000'); // 2.15x avg bonus
    const userBonusCap = web3.utils.toBN('3500000000000000000000'); // 3500 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    const tokenPrice = web3.utils.toBN('50000000000000000'); // 0.5
    const tokenMCap = web3.utils.toBN('1000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 20000 tokens from 541K bonus ones
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('20000000000000000000000');
    expect((await this.holyvisor.getDPY({ from: accounts[3] })).toString()).to.equal('3694294527099194571'); //~3.69% unlocked

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    const tx = await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');

    // expected bonus is 1375.352 * 1.15 * (20000 / 541375.352) = 58.4309867 (and some difference having 1/1e18 in values)
    const expectedBonus = web3.utils.toBN('58430986714001710570'); //58.430986714001710570

    // check for events and amounts in them
    truffleAssert.eventEmitted(tx, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrate.toString();
    });

    truffleAssert.eventEmitted(tx, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonus.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());
  });

  // test if bonus is available for claiming after migration done
  it('should give bonus if bonuses are claimable after migration', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('2500000000000000000000'); // 2500.00
    const totalBonuses = web3.utils.toBN('100000000000000000000000'); // 100000
    const userMultiplier = web3.utils.toBN('3250000000000000000'); // 3.25x avg bonus
    const userBonusCap = web3.utils.toBN('5000000000000000000000'); // 5000 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('2500000000000000000000');

    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('2500000000000000000000'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('2500000000000000000000');

    // perform migration
    const txMigrate = await this.holypassage.migrate({ from: accounts[3] });

    // unlock a portion of the bonuses
    const tokenPrice = web3.utils.toBN('100000000000000000'); // 1.0
    const tokenMCap = web3.utils.toBN('1000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 10000 tokens from 100K bonus ones
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('10000000000000000000000');
    expect((await this.holyvisor.getDPY({ from: accounts[3] })).toString()).to.equal('10000000000000000000'); //10% unlocked

    // expected bonus is 2500 * 2.25 * (10000 / 100000) = 562.5
    const expectedBonus = web3.utils.toBN('562500000000000000000'); //562.5

    // check that portion of bonuses is claimable
    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal(expectedBonus.toString());

    // check appropriate balances of v1 tokens
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('2500000000000000000000');

    // check for event and amount in it
    truffleAssert.eventEmitted(txMigrate, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrate.toString();
    });

    // perform bonus claim
    const txClaimBonus = await this.holypassage.claimBonus({ from: accounts[3] });

    // check for event and amount in it
    truffleAssert.eventEmitted(txClaimBonus, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonus.toString();
    });

    const tokenPriceNew = web3.utils.toBN('150000000000000000'); // 1.5
    const tokenMCapNew = web3.utils.toBN('2250000000000000000000'); // 22500
    await this.holyvisor.UnlockUpdate(tokenMCapNew, tokenPriceNew, { from: accounts[0] }); // unlock 10000 + 8333.33 tokens from 100K bonus ones
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('18333333333333333333333');
    expect((await this.holyvisor.getDPY({ from: accounts[3] })).toString()).to.equal('8333333333333333333'); //~8.3% unlocked on last update

    // check appropriate balances of v2 tokens to contain sum of migrated tokens and bonus
    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());

    // check that counters are properly incremented
    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal(amountMigrate.toString());
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal(expectedBonus.toString());

    // total supply should also match migrated plus bonus token amount
    expect((await this.hhtoken.totalSupply()).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());
  });

  // test if unlocked bonus is more than total bonus tokens
  it('should give correct bonus even if unlocked amount is larger than total bonus tokens amount', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('1375352000000000000001'); // 1375.352
    const totalBonuses = web3.utils.toBN('541375352000000000000001'); // 541375
    const userMultiplier = web3.utils.toBN('2150000000000000000'); // 2.15x avg bonus
    const userBonusCap = web3.utils.toBN('3500000000000000000000'); // 3500 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    // now unlock many tokens (more than the maximum total amount)
    const tokenPrice = web3.utils.toBN('1000000000000'); // 0.000001
    const tokenMCap = web3.utils.toBN('10000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 10B tokens (541K bonus ones)
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('10000000000000000000000000000');

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    const tx = await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');

    // expected bonus is 1375.352 * 1.15 * (1.0) = 1581.6548
    const expectedBonus = web3.utils.toBN('1581654800000000000001'); //1581.6548

    // check for events and amounts in them
    truffleAssert.eventEmitted(tx, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrate.toString();
    });

    truffleAssert.eventEmitted(tx, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonus.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());
  });

  // test if bonus is not available for user but overall unlocked
  it('should not give bonus if user has multiplier and amount cap but not migrated any tokens', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('2500000000000000000000'); // 2500.00
    const totalBonuses = web3.utils.toBN('100000000000000000000000'); // 100000
    const userMultiplier = web3.utils.toBN('3250000000000000000'); // 3.25x avg bonus
    const userBonusCap = web3.utils.toBN('5000000000000000000000'); // 5000 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]); // roles are stored as keccak hash of a role string
    expect(founder_balance.toString()).to.equal('2500000000000000000000');

    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('2500000000000000000000'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('2500000000000000000000');

    // do not perform migration, hence, bonus are not available
    //const txMigrate = await this.holypassage.migrate({ from: accounts[3] });

    // unlock a portion of the bonuses
    const tokenPrice = web3.utils.toBN('100000000000000000'); // 1.0
    const tokenMCap = web3.utils.toBN('1000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 10000 tokens from 100K bonus ones
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('10000000000000000000000');

    // expected bonus is 0
    const expectedBonus = web3.utils.toBN('0'); //562.5

    // check that portion of bonuses is claimable
    expect((await this.holypassage.getClaimableBonus({ from: accounts[3]})).toString()).to.equal(expectedBonus.toString());

    // check appropriate balances of v1 tokens
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('2500000000000000000000');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('0');

    // perform bonus claim attempt
    const txClaimBonus = await this.holypassage.claimBonus({ from: accounts[3] });

    // check for event not emitted
    truffleAssert.eventNotEmitted(txClaimBonus, 'ClaimedBonus', (ev) => {
      return true;
    });

    // check appropriate balances of v2 tokens to contain sum of migrated tokens and bonus
    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal('0');

    // check that counters are properly incremented
    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal('0');
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal(expectedBonus.toString());

    // total supply should also match migrated plus bonus token amount
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('0');
  });

  // check for claimable bonus with migration
  it('should give correct bonus calculation during migration in one transaction', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('1375352000000000000001'); // 1375.352
    const totalBonuses = web3.utils.toBN('541375352000000000000001'); // 541375
    const userMultiplier = web3.utils.toBN('2150000000000000000'); // 2.15x avg bonus
    const userBonusCap = web3.utils.toBN('3500000000000000000000'); // 3500 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    // now unlock many tokens (more than the maximum total amount)
    const tokenPrice = web3.utils.toBN('1000000000000'); // 0.000001
    const tokenMCap = web3.utils.toBN('10000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 10B tokens (541K bonus ones)
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('10000000000000000000000000000');

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]);
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    // expected bonus is 1375.352 * 1.15 * (1.0) = 1581.6548
    const expectedBonus = web3.utils.toBN('1581654800000000000001'); //1581.6548

    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal(expectedBonus.toString());

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    const tx = await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');

    // check for events and amounts in them
    truffleAssert.eventEmitted(tx, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrate.toString();
    });

    truffleAssert.eventEmitted(tx, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonus.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());

    // check that counters are properly incremented
    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal(amountMigrate.toString());
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal(expectedBonus.toString());
    
    // total supply should also match migrated plus bonus token amount
    expect((await this.hhtoken.totalSupply()).toString()).to.equal((web3.utils.toBN(amountMigrate).add(expectedBonus)).toString());
  });

  // test multi-step migration
  it('should give correct amounts and bonus calculation when migrating in several steps (exceeding bonus cap)', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrateStep1 = web3.utils.toBN('1250000000000000000000'); // 1250
    const amountMigrateStep2 = web3.utils.toBN('2400000000000000000000'); // 2400
    const amountMigrateStep3 = web3.utils.toBN('1100000000000000000000'); // 1100, exceeds bonus cap
    const totalBonuses = web3.utils.toBN('300000000000000000000000'); // 300000
    const userMultiplier = web3.utils.toBN('3350000000000000000'); // 3.35x avg bonus
    const userBonusCap = web3.utils.toBN('4500000000000000000000'); // 4000 max user bonus cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    // now 1/2 of bonus tokens
    const tokenPrice = web3.utils.toBN('1000000000000000000'); // 1.0
    const tokenMCap = web3.utils.toBN('150000000000000000000000'); // 150000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 150k
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('150000000000000000000000');

    // increase allowance to 1M to perform migrations
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('9000000000000000000000'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('9000000000000000000000');

    // migrate step 1 with 1250 tokens
    await this.holytoken.transfer(accounts[3], amountMigrateStep1, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]);
    expect(founder_balance.toString()).to.equal(amountMigrateStep1.toString());

    // expected bonus is 1250.0 * 2.35 * (0.5) = 1468.75
    const expectedBonusStep1 = web3.utils.toBN('1468750000000000000000');

    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal(expectedBonusStep1.toString());
    const txStep1 = await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal(amountMigrateStep1.toString());
    truffleAssert.eventEmitted(txStep1, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrateStep1.toString();
    });
    truffleAssert.eventEmitted(txStep1, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonusStep1.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrateStep1).add(expectedBonusStep1)).toString());

    // migrate step 2 with 2400 tokens
    await this.holytoken.transfer(accounts[3], amountMigrateStep2, { from: accounts[1] });
    const founder_balance2 = await this.holytoken.balanceOf(accounts[3]);
    expect(founder_balance2.toString()).to.equal(amountMigrateStep2.toString());

    // expected bonus is (1250.0+2400.0 cap 4500 - 1250.0 migrated) * 2.35 * (0.5) = 2820.0
    const expectedBonusStep2 = web3.utils.toBN('2820000000000000000000');

    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal(expectedBonusStep2.toString());
    const txStep2 = await this.holypassage.migrate({ from: accounts[3] });
    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal('0');

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal(web3.utils.toBN(amountMigrateStep1).add(amountMigrateStep2).toString());
    truffleAssert.eventEmitted(txStep2, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrateStep2.toString();
    });
    truffleAssert.eventEmitted(txStep2, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonusStep2.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrateStep1).add(expectedBonusStep1).add(amountMigrateStep2).add(expectedBonusStep2)).toString());

    // migrate step 3 with 1100 tokens
    await this.holytoken.transfer(accounts[3], amountMigrateStep3, { from: accounts[1] });
    const founder_balance3 = await this.holytoken.balanceOf(accounts[3]);
    expect(founder_balance3.toString()).to.equal(amountMigrateStep3.toString());

    // expected bonus is (1250.0+2400.0+1100.0 cap 4500 - (1250.0+2400) migrated)
    // (4750->4500 - 3650) * 2.35 * (0.5) = 998.75
    const expectedBonusStep3 = web3.utils.toBN('998750000000000000000');

    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal(expectedBonusStep3.toString());
    const txStep3 = await this.holypassage.migrate({ from: accounts[3] });
    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal('0');

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal(web3.utils.toBN(amountMigrateStep1).add(amountMigrateStep2).add(amountMigrateStep3).toString());
    truffleAssert.eventEmitted(txStep3, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrateStep3.toString();
    });
    truffleAssert.eventEmitted(txStep3, 'ClaimedBonus', (ev) => {
      return ev.user === accounts[3] && ev.amount.toString() === expectedBonusStep3.toString();
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal((web3.utils.toBN(amountMigrateStep1).add(expectedBonusStep1).add(amountMigrateStep2).add(expectedBonusStep2).add(amountMigrateStep3).add(expectedBonusStep3)).toString());

    // check that counters are properly incremented
    const totalAmountMigrated = web3.utils.toBN(amountMigrateStep1).add(amountMigrateStep2).add(amountMigrateStep3);
    const totalBonusClaimed = web3.utils.toBN(expectedBonusStep1).add(expectedBonusStep2).add(expectedBonusStep3);
    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal(totalAmountMigrated.toString());
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal(totalBonusClaimed.toString());

    // user claimed all available bonus
    expect(totalBonusClaimed.toString() === userBonusCap.toString());
    
    // total supply should also match migrated plus bonus token amount
    expect((await this.hhtoken.totalSupply()).toString()).to.equal((web3.utils.toBN(totalAmountMigrated).add(totalBonusClaimed)).toString());
  });


  // check for claimable bonus with migration
  it('should allow migration even if no bonus data is available', async function () {
    // migrate from account 3, transfer balance from account 1
    const amountMigrate = web3.utils.toBN('1375352000000000000001'); // 1375.352
    const totalBonuses = web3.utils.toBN('541375352000000000000001'); // 541375
    const userMultiplier = web3.utils.toBN('2150000000000000000'); // 2.15x avg bonus
    const userBonusCap = web3.utils.toBN('3500000000000000000000'); // 3500 max cap
    
    // total bonuses and bonus claim is enabled
    await this.holypassage.setBonusClaimEnabled(true, { from: accounts[0] });
    await this.holyvisor.setTotalAmount.sendTransaction(totalBonuses, { from: accounts[0] });
    // do not set data for this account to migrate
    //await this.holyvisor.setData([accounts[3]], [userMultiplier], [userBonusCap], { from: accounts[0] });

    // now unlock many tokens (more than the maximum total amount)
    const tokenPrice = web3.utils.toBN('1000000000000'); // 0.000001
    const tokenMCap = web3.utils.toBN('10000000000000000000000'); // 10000
    await this.holyvisor.UnlockUpdate(tokenMCap, tokenPrice, { from: accounts[0] }); // unlock 10B tokens (541K bonus ones)
    expect((await this.holyvisor.bonusTotalUnlocked({ from: accounts[3]})).toString()).to.equal('10000000000000000000000000000');

    await this.holytoken.transfer(accounts[3], amountMigrate, { from: accounts[1] });
    const founder_balance = await this.holytoken.balanceOf(accounts[3]);
    expect(founder_balance.toString()).to.equal('1375352000000000000001');

    // no bonus is available for account
    expect((await this.holypassage.getClaimableMigrationBonus({ from: accounts[3]})).toString()).to.equal('0');

    // increase allowance to 1M
    await this.holytoken.approve.sendTransaction(this.holypassage.address, web3.utils.toBN('1375352000000000000001'), { from: accounts[3] });
    expect((await this.holytoken.allowance(accounts[3], this.holypassage.address, { from: accounts[3] })).toString()).to.equal('1375352000000000000001');

    // perform migration
    const tx = await this.holypassage.migrate({ from: accounts[3] });

    // check appropriate balances
    expect((await this.holytoken.balanceOf(accounts[3])).toString()).to.equal('0');
    expect((await this.holytoken.balanceOf('0x000000000000000000000000000000000000dEaD')).toString()).to.equal('1375352000000000000001');

    // check for events and amounts in them
    truffleAssert.eventEmitted(tx, 'Migrated', (ev) => {
      return ev.user.toString() === accounts[3].toString() && ev.amount.toString() === amountMigrate.toString();
    });

    truffleAssert.eventNotEmitted(tx, 'ClaimedBonus', (ev) => {
      return true;
    });

    expect((await this.hhtoken.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN(amountMigrate).toString());

    // check that counters are properly incremented
    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal(amountMigrate.toString());
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal('0');
    
    // total supply should also match migrated plus bonus token amount
    expect((await this.hhtoken.totalSupply()).toString()).to.equal(web3.utils.toBN(amountMigrate).toString());
  });

  // check for admin correction of migrated tokens and claimed bonus tokens
  it('should allow admin to change migrated tokens amounts and claimed bonus tokens amounts', async function () {
    const userMigrated = web3.utils.toBN('16343000000000000000');
    const userClaimedBonus = web3.utils.toBN('3751000000000000000');
    
    await truffleAssert.reverts(this.holypassage.setMigratedAmounts([accounts[3]], [userMigrated], { from: accounts[2] }), "Admin only");
    await truffleAssert.reverts(this.holypassage.setMigratedAmounts([accounts[3]], [], { from: accounts[0] }), "Array length mismatch");
    await truffleAssert.reverts(this.holypassage.setClaimedBonusAmounts([accounts[3]], [userClaimedBonus], { from: accounts[2] }), "Admin only");

    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal('0');
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal('0');

    await this.holypassage.setMigratedAmounts([accounts[3]], [userMigrated], { from: accounts[0] });
    await this.holypassage.setClaimedBonusAmounts([accounts[3]], [userClaimedBonus], { from: accounts[0] });

    expect((await this.holypassage.migratedTokens(accounts[3])).toString()).to.equal('16343000000000000000');
    expect((await this.holypassage.claimedBonusTokens(accounts[3])).toString()).to.equal('3751000000000000000');
  });

  // test multi-step claim
});
