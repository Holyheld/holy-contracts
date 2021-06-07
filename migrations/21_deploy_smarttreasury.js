// migrations/20_deploy_smarttreasury.js
const SmartTreasury = artifacts.require('SmartTreasury');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV2 = artifacts.require('HolyHandV2');

const { deployProxy } = require('@openzeppelin/truffle-upgrades');
 
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let usdcaddr = "";
  let moveaddr = "";
  let movelpaddr = "";
  let holyhandaddr = "";

  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyhandaddr = (await HolyHandV2.deployed()).address;
    usdcaddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    moveaddr = (await MoverToken.deployed()).address;
    movelpaddr = "0x87b918e76c92818DB0c76a4E174447aeE6E6D23f";
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyhandaddr = (await HolyHandV2.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    // deploy mocked MOVE-LP token
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyhandaddr = (await HolyHandV2.deployed()).address;
    usdcaddr = "0x75b0622cec14130172eae9cf166b92e5c112faff";
    moveaddr = (await MoverToken.deployed()).address;
    movelpaddr = "0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa"; // we'll use kovan-DAI for tests
  } else {
    // deploy mocked USDC and MOVE-LP tokens
    founderaddr = accounts[0];
    holyhandaddr = (await HolyHandV2.deployed()).address;
    usdcaddr = (await MoverToken.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
    movelpaddr = (await MoverToken.deployed()).address;
  }

  console.log("DEPLOYING SMART TREASURY, network=" + network)
  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (usdcaddr == '') {
    throw("ERROR: no address set for base token (USDC)");
  }
  if (moveaddr == '') {
    throw("ERROR: no address set for MOVE token");
  }
  if (movelpaddr == '') {
    throw("ERROR: no address set for MOVE-LP token");
  }
  if (holyhandaddr == '') {
    throw("ERROR: no address set for HolyHand execute/transfer proxy");
  }

  const contractInstance = await deployProxy(SmartTreasury, ["Mover Bonus", "MOBO", usdcaddr, moveaddr, movelpaddr], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('SmartTreasury deployed at address: ', contractInstance.address);

  // set EXECUTOR_ROLE to HolyHand execution/transfer proxy
  await contractInstance.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), holyhandaddr, { from: founderaddr });
  console.log('SmartTreasury EXECUTOR_ROLE (' + web3.utils.sha3("EXECUTOR_ROLE") + ') set for HolyHand transfer/execution proxy at address: ', holyhandaddr);
};
