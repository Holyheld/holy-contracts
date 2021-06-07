// test/SmartTreasury.staking.test.js

const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

const SmartTreasury = artifacts.require('SmartTreasuryV2');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockDAI = artifacts.require('ERC20DAIMock');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');

contract('SmartTreasury (staking, yield, APY)', function (accounts) {
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

  // stake/unstake MOVE token
  it('should allow to stake/unstake MOVE tokens', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('2000000');

    await truffleAssert.reverts(this.hh.depositToTreasury(web3.utils.toBN('2000000000000000000000'), 0, { from: accounts[1] }), "transfer amount exceeds balance");
    await truffleAssert.reverts(this.hh.depositToTreasury(web3.utils.toBN('12000000000'), 0, { from: accounts[1] }), "transfer amount exceeds allowance");

    await truffleAssert.reverts(this.st.withdraw(web3.utils.toBN('0'), web3.utils.toBN('15'), { from: accounts[1] }), "withdraw: insufficient balance");
    await truffleAssert.reverts(this.st.withdraw(web3.utils.toBN('20000000'), web3.utils.toBN('0'), { from: accounts[1] }), "withdraw: insufficient balance");

    await this.st.withdraw(web3.utils.toBN('500000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998500000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('1500000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('1500000');

    // withdraw full remainder
    await this.st.withdraw(web3.utils.toBN('1500000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
  });

  // stake/unstake MOVE-LP token
  it('should allow to stake/unstake MOVE-ETH LP tokens', async function() {
    // account[1] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('2000000'), { from: accounts[1] });

    expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMoveEthLP(accounts[1]))[0].toString()).to.equal('2000000');

    await truffleAssert.reverts(this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('2000000000000000000000'), { from: accounts[1] }), "transfer amount exceeds balance");
    await truffleAssert.reverts(this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('12000000000'), { from: accounts[1] }), "transfer amount exceeds allowance");

    await truffleAssert.reverts(this.st.withdraw(web3.utils.toBN('15'), web3.utils.toBN('0'), { from: accounts[1] }), "withdraw: insufficient balance");
    await truffleAssert.reverts(this.st.withdraw(web3.utils.toBN('0'), web3.utils.toBN('20000000'), { from: accounts[1] }), "withdraw: insufficient balance");

    await this.st.withdraw(web3.utils.toBN('0'), web3.utils.toBN('500000'), { from: accounts[1] });

    expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal('999999999999998500000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('1500000');
    expect((await this.st.userInfoMoveEthLP(accounts[1]))[0].toString()).to.equal('1500000');

    // withdraw full remainder
    await this.st.withdraw(web3.utils.toBN('0'), web3.utils.toBN('1500000'), { from: accounts[1] });
    expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMoveEthLP(accounts[1]))[0].toString()).to.equal('0');
  });

  // stake/unstake MOVE token and distribute yield, receive bonus tokens upon deposit/withdraw
  it('should allow to stake/unstake MOVE tokens and distribute yield (having zero MOVE LP staked)', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');
  });

  // stake/unstake MOVE-LP token and distribute yield, receive bonus tokens upon deposit/withdraw
  it('should allow to stake/unstake MOVE-LP tokens and distribute yield (having zero MOVE staked)', async function() {
    // account[1] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('2000000'), { from: accounts[1] });

    expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('2000000');
    expect((await this.st.userInfoMoveEthLP(accounts[1]))[0].toString()).to.equal('2000000');

    // provide ST some yield to distribute
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');

    // ST must have portion in endowment, other amount goes to bonus for accounts[1]
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('500');

    // deposit some more MOVE-LP, this should trigger receiving of bonus tokens
    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('2000000'), { from: accounts[1] });

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

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('0'), web3.utils.toBN('4000000'), { from: accounts[1] });
    expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');
  });

  // stake/unstake multiple parties and disitribute bonuses correctly
  it('should allow to stake/unstake multiple parties and disitribute bonuses correctly', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // 2ND account starts staking MOVE-ETH LP
    // account[2] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('1000000'), { from: accounts[2] });

    expect((await this.movelpmock.balanceOf(accounts[2])).toString()).to.equal('999999999999999000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('1000000');
    expect((await this.st.userInfoMoveEthLP(accounts[2]))[0].toString()).to.equal('1000000');

    // now ST has 4000000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 1000 goes to endowment, 1000 to bonuses, total weight 6500000
    // account1 with 4000000 MOVE gets 1000*4000000/6500000 = 615.38..
    // account2 with 1000000 MOVE-ETH gets 1000*2500000/6500000 = 384.61..
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('0');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // account2 deposits some MOVE tokens too
    await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999996000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('999999999999996500000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('4000000');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('3500000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('7500000');

    // now ST has 7500000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 2500 goes to endowment, 2500 to bonuses, total weight 10000000
    // account1 with 4000000 MOVE gets 2500*4000000/10000000 = 1000
    // account2 with 3500000 MOVE and 1000000 MOVE-ETH gets 2500*3500000/10000000 + 2500*2500000/10000000 = 875 + 625 = 1500
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('5000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('8000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('2115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('1500');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('1885');
    expect((await this.st.endowmentBalance()).toString()).to.equal('4000');
    expect((await this.st.bonusBalance()).toString()).to.equal('4000');

    // withdraw full amount, this should trigger receiving of all pending bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    await this.st.withdraw(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    // all MOVE tokens should be back at their owners
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('2115');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('2115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('1885');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('1885');
  });

  // allow to change endowment proportion
  it('should allow to change endowment proportion and distribute bonuses correctly', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // 2ND account starts staking MOVE-ETH LP
    // account[2] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('1000000'), { from: accounts[2] });

    expect((await this.movelpmock.balanceOf(accounts[2])).toString()).to.equal('999999999999999000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('1000000');
    expect((await this.st.userInfoMoveEthLP(accounts[2]))[0].toString()).to.equal('1000000');

    // now ST has 4000000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 1000 goes to endowment, 1000 to bonuses, total weight 6500000
    // account1 with 4000000 MOVE gets 1000*4000000/6500000 = 615.38..
    // account2 with 1000000 MOVE-ETH gets 1000*2500000/6500000 = 384.61..
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('0');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // account2 deposits some MOVE tokens too
    await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999996000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('999999999999996500000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('4000000');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('3500000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('7500000');

    // change propotion of endowment, raise it to 75% of all yield received
    const finmgmt_role = await this.st.FINMGMT_ROLE(); // roles are stored as keccak hash of a role string
    await this.st.grantRole(finmgmt_role, accounts[0]);
    await this.st.setEndowmentPercentage.sendTransaction(web3.utils.toBN('75000000000000000000'), { from: accounts[0] });

    // now ST has 7500000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 3000 goes to endowment, 1000 to bonuses, total weight 10000000
    // account1 with 4000000 MOVE gets 1000*4000000/10000000 = 400
    // account2 with 3500000 MOVE and 1000000 MOVE-ETH gets 1000*3500000/10000000 + 1000*2500000/10000000 = 350 + 250 = 600
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('4000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('7000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('1015');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1515');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('600');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('985');
    expect((await this.st.endowmentBalance()).toString()).to.equal('4500');
    expect((await this.st.bonusBalance()).toString()).to.equal('2500');

    // withdraw full amount, this should trigger receiving of all pending bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    await this.st.withdraw(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    // all MOVE tokens should be back at their owners
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1515');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1515');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('985');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('985');
  });

  // allow to change endowment proportion to zero, all goes to bonuses
  it('should allow to change endowment proportion to zero and distribute bonuses correctly', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // 2ND account starts staking MOVE-ETH LP
    // account[2] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('1000000'), { from: accounts[2] });

    expect((await this.movelpmock.balanceOf(accounts[2])).toString()).to.equal('999999999999999000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('1000000');
    expect((await this.st.userInfoMoveEthLP(accounts[2]))[0].toString()).to.equal('1000000');

    // now ST has 4000000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 1000 goes to endowment, 1000 to bonuses, total weight 6500000
    // account1 with 4000000 MOVE gets 1000*4000000/6500000 = 615.38..
    // account2 with 1000000 MOVE-ETH gets 1000*2500000/6500000 = 384.61..
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('0');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // account2 deposits some MOVE tokens too
    await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999996000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('999999999999996500000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('4000000');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('3500000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('7500000');

    // change propotion of endowment, raise it to 0% of all yield received
    const finmgmt_role = await this.st.FINMGMT_ROLE(); // roles are stored as keccak hash of a role string
    await this.st.grantRole(finmgmt_role, accounts[0]);
    await this.st.setEndowmentPercentage.sendTransaction(web3.utils.toBN('0'), { from: accounts[0] });

    // now ST has 7500000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 0 goes to endowment, 10000 to bonuses, total weight 10000000
    // account1 with 4000000 MOVE gets 10000*4000000/10000000 = 4000
    // account2 with 3500000 MOVE and 1000000 MOVE-ETH gets 10000*3500000/10000000 + 10000*2500000/10000000 = 3500 + 2500 = 6000
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('10000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('13000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('4615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('5115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('6000');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('6385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');
    expect((await this.st.bonusBalance()).toString()).to.equal('11500');

    // withdraw full amount, this should trigger receiving of all pending bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    await this.st.withdraw(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    // all MOVE tokens should be back at their owners
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('5115');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('5115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('6385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('6385');
  });

  // allow to change endowment proportion to 100%, all goes to endowment
  it('should allow to change endowment proportion to 100% and distribute bonuses correctly', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // 2ND account starts staking MOVE-ETH LP
    // account[2] would deposit some tokens through transfer proxy
    await this.movelpmock.transfer.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('0'), web3.utils.toBN('1000000'), { from: accounts[2] });

    expect((await this.movelpmock.balanceOf(accounts[2])).toString()).to.equal('999999999999999000000');
    expect((await this.movelpmock.balanceOf(this.st.address)).toString()).to.equal('1000000');
    expect((await this.st.userInfoMoveEthLP(accounts[2]))[0].toString()).to.equal('1000000');

    // now ST has 4000000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 1000 goes to endowment, 1000 to bonuses, total weight 6500000
    // account1 with 4000000 MOVE gets 1000*4000000/6500000 = 615.38..
    // account2 with 1000000 MOVE-ETH gets 1000*2500000/6500000 = 384.61..
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('0');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1500');

    // account2 deposits some MOVE tokens too
    await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[2] });

    await this.hh.depositToTreasury(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999996000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('999999999999996500000');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('4000000');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('3500000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('7500000');

    // change propotion of endowment, raise it to 100% of all yield received
    const finmgmt_role = await this.st.FINMGMT_ROLE(); // roles are stored as keccak hash of a role string
    await this.st.grantRole(finmgmt_role, accounts[0]);
    await this.st.setEndowmentPercentage.sendTransaction(web3.utils.toBN('100000000000000000000'), { from: accounts[0] });

    // now ST has 7500000 MOVE and 1000000 MOVE-ETH LP staked
    // provide ST some yield to distribute
    // 0 goes to endowment, 10000 to bonuses, total weight 10000000
    // account1 with 4000000 MOVE gets 10000*4000000/10000000 = 4000
    // account2 with 3500000 MOVE and 1000000 MOVE-ETH gets 10000*3500000/10000000 + 10000*2500000/10000000 = 3500 + 2500 = 6000
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('10000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('13000');
    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('615');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
    expect((await this.st.endowmentBalance()).toString()).to.equal('11500');
    expect((await this.st.bonusBalance()).toString()).to.equal('1500');

    // withdraw full amount, this should trigger receiving of all pending bonus tokens
    await this.st.withdraw(web3.utils.toBN('4000000'), web3.utils.toBN('0'), { from: accounts[1] });
    await this.st.withdraw(web3.utils.toBN('3500000'), web3.utils.toBN('0'), { from: accounts[2] });

    // all MOVE tokens should be back at their owners
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('1115');
    expect((await this.st.balanceOf(accounts[2])).toString()).to.equal('385');
    expect((await this.st.pendingBonus(accounts[2])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[2])).toString()).to.equal('385');
  });

  // allow to received yield without anything staked
  it('should allow to distribute bonuses correctly if nothing is staked', async function() {
    await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000'), { from: accounts[0] });

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('1000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('1000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.endowmentBalance()).toString()).to.equal('1000');

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('3000');
    expect((await this.st.endowmentBalance()).toString()).to.equal('3000');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('0');

    // change propotion of endowment, raise it to 30% of all yield received
    // nothing is staked, so endowment still receives all yield
    const finmgmt_role = await this.st.FINMGMT_ROLE(); // roles are stored as keccak hash of a role string
    await this.st.grantRole(finmgmt_role, accounts[0]);
    await this.st.setEndowmentPercentage.sendTransaction(web3.utils.toBN('30000000000000000000'), { from: accounts[0] });

    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('10000'), { from: accounts[0] });

    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('13000');
    expect((await this.st.endowmentBalance()).toString()).to.equal('13000');
    expect((await this.st.bonusBalance()).toString()).to.equal('0');
  });

  // counts APY correctly
  it('should count APY correctly', async function() {
    // account[1] would deposit some tokens through transfer proxy
    const minter_role = await this.mover.MINTER_ROLE(); // roles are stored as keccak hash of a role string
    await this.mover.grantRole(minter_role, accounts[0]);
    await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN('1000000000000000000000'), { from: accounts[0] }); // 1000 MOVE
    // grant allowance to HH on MOVE token from accounts[1]
    await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000'), { from: accounts[1] });

    await this.hh.depositToTreasury(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('999999999999998000000');
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

    // skip 10 days
    await time.increase(web3.utils.toBN('864000'));

    // endowment balance is 1500 USDC, 10 days passed
    // total amount of tokens staked is 400000
    // APY assumed 1500 * 100 * (86400 / 864000) / 4000000 ~= 0.00375 daily % (3749750000000000 in 1e18 decimals)
    // 150 USDC on 4000000 MOVE staked in a day = 0,0000375 USD per MOVE token in a day, 0,00375 daily %
    // but this is without difference of decimals, 1 USDC are 1e12 'larger' for same decimal digit position
    // so add 12 zeroes to this particular case, getting 3749750000000000000000000000
    // this is very high APY but it's correct for this particular case
    // due to block time randomness, check only approximate value
    var APYval = (await this.st.getDPYPerMoveToken()).toString();
    expect(APYval.substring(0,5)).to.equal('37499'); // ~= 3749991319464538250000000000
    expect(APYval.length).to.equal(28);

    // skip 10 days, APY should decrease if no profit received
    await time.increase(web3.utils.toBN('864000'));
    var APYval = (await this.st.getDPYPerMoveToken()).toString();
    expect(APYval.substring(0,5)).to.equal('18749'); // ~= 1874997829863622750000000000
    expect(APYval.length).to.equal(28);

    // skip 10 days, and receive profit
    await time.increase(web3.utils.toBN('864000'));
    await this.st.receiveProfit.sendTransaction(web3.utils.toBN('2000'), { from: accounts[0] });
    expect((await this.mockusdc.balanceOf(this.st.address)).toString()).to.equal('5000');

    await this.st.withdraw(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });

    // APY assumed 2500 * 100 * (86400 / 3*864000)/ 2000000 ~= 0.004166 daily % (4166000000000000 in 1e18 decimals)
    var APYval = (await this.st.getDPYPerMoveToken()).toString();
    expect(APYval.substring(0,5)).to.equal('41666'); // ~= 4166663451648571000000000000
    expect(APYval.length).to.equal(28);

    // withdraw full amount, this should trigger receiving of bonus tokens
    await this.st.withdraw(web3.utils.toBN('2000000'), web3.utils.toBN('0'), { from: accounts[1] });
    expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal('1000000000000000000000');
    expect((await this.mover.balanceOf(this.st.address)).toString()).to.equal('0');
    expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal('0');

    expect((await this.st.balanceOf(accounts[1])).toString()).to.equal('2500');
    expect((await this.st.pendingBonus(accounts[1])).toString()).to.equal('0');
    expect((await this.st.totalBonus(accounts[1])).toString()).to.equal('2500');
    expect((await this.st.endowmentBalance()).toString()).to.equal('2500');

    expect((await this.st.getDPYPerMoveToken()).toString()).to.equal('0');
  });
});