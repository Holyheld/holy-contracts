// test/HolyVisor.test.js
// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
//const web3 = require('web3');

// Load compiled artifacts
const HolyVisor = artifacts.require('HolyVisorV3');

contract('HolyVisor', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.holyvisor = await deployProxy(HolyVisor, [], { unsafeAllowCustomTypes: true, from: accounts[0] });
  });

  it('should have bonus tokens unlock recalculated based on market cap', async function () {
    await truffleAssert.reverts(this.holyvisor.setTotalAmount(web3.utils.toBN('312412312312'), { from: accounts[1] }), "Admin only");
    await this.holyvisor.setTotalAmount(web3.utils.toBN('300000000000000000000000000'), { from: accounts[0] });

    // unlock 50%
    await this.holyvisor.UnlockUpdate(web3.utils.toBN('150000000000000000000000000'), web3.utils.toBN('1000000000000000000'), { from: accounts[0] });
    expect((await this.holyvisor.bonusTotalUnlocked()).toString()).to.equal('150000000000000000000000000');

    // on unlock when mcap not increased
    await this.holyvisor.UnlockUpdate(web3.utils.toBN('140000000000000000000000000'), web3.utils.toBN('900000000000000000'), { from: accounts[0] });
    expect((await this.holyvisor.bonusTotalUnlocked()).toString()).to.equal('150000000000000000000000000');

    // unlock ~ +25%
    await this.holyvisor.UnlockUpdate(web3.utils.toBN('210000000000000000000000000'), web3.utils.toBN('900000000000000000'), { from: accounts[0] });
    expect((await this.holyvisor.bonusTotalUnlocked()).toString()).to.equal('227777777777777777777777777');

    // unlock more than total bonus amount
    await this.holyvisor.UnlockUpdate(web3.utils.toBN('9990000000000000000000000000'), web3.utils.toBN('900000000000000000'), { from: accounts[0] });
    expect((await this.holyvisor.bonusTotalUnlocked()).toString()).to.equal('300000000000000000000000000');
  });
});