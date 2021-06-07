// test/HHToken.test.js
// Load dependencies
const { expect } = require('chai');
const web3 = require('web3');

// Load compiled artifacts
const HHToken = artifacts.require('HHTokenV2');

contract('HHToken', function (accounts) {
  beforeEach(async function () {
    // Deploy a new contract for each test
    this.hhtoken = await HHToken.new("HH", "Holyheld Token", { from: accounts[0] });
  });
 
  it('should not have any circulation supply upon deploy', async function () {
    // Note that we need to use strings to compare the 256 bit integers
    expect((await this.hhtoken.totalSupply()).toString()).to.equal('0');
  });
});