// test/SmartTreasury.claimburn.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

const SmartTreasury = artifacts.require('SmartTreasury');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');

contract('SmartTreasury (claim & burn)', function (accounts) {
  beforeEach(async function () {
    this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
    this.mover = await deployProxy(MoverToken, ["Mover", "MOVE"], { unsafeAllowCustomTypes: true, from: accounts[0] });
    // mock of DAI suits us (18 decimals) as simple ERC20 token
    this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });
    this.st = await deployProxy(SmartTreasury, ["SmartTreasury", "STB", this.mockusdc.address, this.mover.address, this.movelpmock.address], { unsafeAllowCustomTypes: true, from: accounts[0] });
    this.hh = await deployProxy(HolyHandV3, { unsafeAllowCustomTypes: true, from: accounts[0] });

    await this.st.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), this.hh.address, { from: accounts[0] });
    await this.hh.setSmartTreasury.sendTransaction(this.st.address, { from: accounts[0] });
    await this.hh.setTreasuryTokens.sendTransaction(this.mover.address, this.movelpmock.address, { from: accounts[0] });
    await time.advanceBlock();
  });

  // stake/unstake MOVE token and perform claim & burn on some tokens
  it('should allow to burn a portion of MOVE without any bonus available', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // transfer some move tokens to accounts[2], who would perform claim & burn
    // total supply of MOVE tokens is 1000000000000
    await this.mover.transfer.sendTransaction(accounts[2], web3.utils.toBN('500000000'), { from: accounts[1] }); // 50% of total MOVE supply
    // burn of 20% of supply should fail due to max burn limit
    await truffleAssert.reverts(this.st.claimAndBurnOnBehalf(accounts[2], web3.utils.toBN('500000000'), { from: accounts[2] }), "executor only");
    await truffleAssert.reverts(this.hh.claimAndBurn(web3.utils.toBN('50000'), { from: accounts[2] }), "burn amount exceeds allowance");
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[2] });
    expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('50000000')))[0].toString()).to.equal('300');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('50000000')))[1].toString()).to.equal('0');
    
    await truffleAssert.reverts(this.hh.claimAndBurn(web3.utils.toBN('500000000'), { from: accounts[2] }), "max amount exceeded");
    // burn 5% (1/20) of total supply, receive 5% * 4 = 20% of total endowment USDC 
    await this.hh.claimAndBurn(web3.utils.toBN('50000000'), { from: accounts[2] });

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('500000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1200'); //  1500 * 0.8 = 1200
    // account 2 should have 300 USDC, total supply should be lower
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('450000000');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('2700');
    expect((await this.mockusdc.balanceOf(accounts[2])).toString()).to.equal('300');
    expect((await this.mover.totalSupply()).toString()).to.equal('950000000');
  });

  // stake/unstake MOVE token and perform claim & burn in addition burning only portion of pending bonus
  it('should allow to perform claim & burn, in addition burning only portion of pending bonus (max bonus threshold)', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // total supply of MOVE tokens is 1000000000
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });
    expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('10000000')))[0].toString()).to.equal('60');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('10000000')))[1].toString()).to.equal('15');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('10000000')))[0].toString()).to.equal('60');
    expect((await this.st.getBurnValuePortions(accounts[2], web3.utils.toBN('10000000')))[1].toString()).to.equal('0');
    
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[1] });
    await this.hh.claimAndBurn(web3.utils.toBN('10000000'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('985');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1485');

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.totalSupply()).toString()).to.equal('990000000');
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('990000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');

    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1485');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1485');

    expect((await this.st.endowmentBalance()).toString()).to.equal('1440');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('2925');
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('75');
  });

  // stake/unstake MOVE token and perform claim & burn in addition burning all pending and part tokenized bonus
  it('should allow to perform claim & burn, in addition burning all pending and part of tokenized bonus', async function() {
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    // yield of 1000000 to treasury
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000000'), { from: accounts[0] });

    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1001000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1003000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1001500');

    // total supply of MOVE tokens is 1000000000
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });
    expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('1200000')))[0].toString()).to.equal('4804');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('1200000')))[1].toString()).to.equal('1201'); // all pending bonuses + part of tokenized bonuses
    
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[1] });
    await this.hh.claimAndBurn(web3.utils.toBN('1200000'), { from: accounts[1] });

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.totalSupply()).toString()).to.equal('998800000');
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998800000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');

    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('299'); // 1000 pending + 500 tokens - 1201 = 299 tokens left
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('299');

    expect((await this.st.endowmentBalance()).toString()).to.equal('996696');
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('996995');
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('6005');
  });

  // stake/unstake MOVE token and perform claim & burn in addition burning all pending and all tokenized bonus
  it('should allow to perform claim & burn, in addition burning all pending and all of tokenized bonus', async function() {
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    // yield of 1000000 to treasury
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000000'), { from: accounts[0] });

    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000'), { from: accounts[0] }); // 1 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1001000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // deposit some more MOVE, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000500');

    // provide ST some yield to distribute
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1003000');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1001500');

    // total supply of MOVE tokens is 1000000000
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });
    expect((await this.st.maxBurnAmount()).toString()).to.equal('100000000');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('2400000')))[0].toString()).to.equal('9612');
    expect((await this.st.getBurnValuePortions(accounts[1], web3.utils.toBN('2400000')))[1].toString()).to.equal('1500'); // all bonuses pending + tokenized
    
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('500000000'), { from: accounts[1] });
    await this.hh.claimAndBurn(web3.utils.toBN('2400000'), { from: accounts[1] });

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.totalSupply()).toString()).to.equal('997600000');
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('997600000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');

    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('0'); // 1000 pending + 500 tokens - 1201 = 299 tokens left
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('0');

    expect((await this.st.endowmentBalance()).toString()).to.equal('991888'); // 1001500 - 9612 = 991892
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('991888'); // 1003000 - 9612 - 1500 = 991892
    expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('11112');
  });
});
