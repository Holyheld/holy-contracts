// test/HHToken.permit.test.js
// Load dependencies
const { expect, assert } = require("chai");
const truffleAssert = require('truffle-assertions');
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

const { signERC2612Permit } = require("eth-permit");
const Web3 = require("web3");

const { toUtf8Bytes } = require('@ethersproject/strings');
const { keccak256 } = require('@ethersproject/keccak256');
const { defaultAbiCoder } = require('@ethersproject/abi');

// Load compiled artifacts
const HHToken = artifacts.require('HHTokenV2');
const MoverToken = artifacts.require('MoverToken');

const web3 = new Web3("http://localhost:8545");

const PERMIT_TYPEHASH = keccak256(
    toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
);

// Gets the EIP712 domain separator
function getDomainSeparator(name, contractAddress, chainId) {
    return keccak256(
      defaultAbiCoder.encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [
          keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
          keccak256(toUtf8Bytes(name)),
          keccak256(toUtf8Bytes('1')),
          chainId,
          contractAddress,
        ]
      )
    )
}

contract('MoverToken (permit features)', function (accounts) {
    beforeEach(async function () {
      // Deploy a new contract for each test
      this.hhtokenold = await deployProxy(HHToken, ["Holyheld", "HH"], { unsafeAllowCustomTypes: true, from: accounts[0] });
      this.hhtoken = await upgradeProxy(this.hhtokenold.address, MoverToken, { unsafeAllowCustomTypes: true });
      await this.hhtoken.setTokenName("MOVE", "Mover");
    });
    
    it('initializes DOMAIN_SEPARATOR correctly', async function () {
      const chainId = await web3.eth.getChainId();
      assert.equal(await this.hhtoken.DOMAIN_SEPARATOR(), getDomainSeparator("Mover", this.hhtoken.address, chainId))
    });

    it("should set allowance after a permit transaction", async function () {
      const value = web3.utils.toWei("2", "ether");

      //console.log(web3);
      const defaultSender = accounts[1];
      const defaultSpender = accounts[2];

      const result = await signERC2612Permit(
        web3.currentProvider,
        this.hhtoken.address,
        defaultSender,
        defaultSpender,
        value
      );

      // note: these exceptions vary like "ECDSA: invalid signature 's' value", "ERC20Permit: invalid signature", etc.
      //       but this really depends on contract address too, which is random between different test runs, so match substring
      // cannot send with wrong parameters (using wrong parameter order)
      await truffleAssert.reverts(this.hhtoken.permit(defaultSender, defaultSpender, value, result.deadline, result.v + 42, result.r, result.s, { from: accounts[5] }), "invalid signature");
      await truffleAssert.reverts(this.hhtoken.permit(defaultSender, defaultSpender, value, result.deadline, result.v, result.r, result.r, { from: accounts[5] }), "invalid signature");
      await truffleAssert.reverts(this.hhtoken.permit(defaultSender, defaultSpender, value, result.deadline, result.v, result.s, result.s, { from: accounts[5] }), "invalid signature");

      // wrong owner address
      await truffleAssert.reverts(this.hhtoken.permit(accounts[3], defaultSpender, value, result.deadline, result.v, result.r, result.s, { from: accounts[5] }), "invalid signature");

      // send from arbitrary account (account5 because we have signature from owner)
      const receipt = await this.hhtoken.permit(defaultSender, defaultSpender, value, result.deadline, result.v, result.r, result.s, { from: accounts[5] });
      const event = receipt.logs[0];
  
      // check if permit call did increase allowance
      assert.equal(event.event, 'Approval');
      assert.equal(await this.hhtoken.nonces(defaultSender), 1);
      assert.equal(await this.hhtoken.allowance(defaultSender, defaultSpender), value);

      // second permit call should fail (nonce mismatch)
      await truffleAssert.reverts(this.hhtoken.permit(defaultSender, defaultSpender, value, result.deadline, result.v, result.r, result.s, { from: accounts[5] }), "invalid signature");
    });
});
