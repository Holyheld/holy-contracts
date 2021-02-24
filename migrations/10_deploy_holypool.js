// migrations/10_deploy_holypool.js
const HolyPool = artifacts.require('HolyPool');
const HolyHand = artifacts.require('HolyHand');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let ERC20USDCaddr = "";
  let holyHandaddr = (await HolyHand.deployed()).address;
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    ERC20USDCaddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    ERC20USDCaddr = "0x75b0622cec14130172eae9cf166b92e5c112faff";
  } else {
    founderaddr = accounts[0];
    const ERC20USDCMock = artifacts.require('ERC20USDCMock');
    const USDCMockInstance = await deployer.deploy(ERC20USDCMock, founderaddr);
    ERC20USDCaddr = USDCMockInstance.address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyHandaddr == '') {
    throw("ERROR: no address set for HolyHand");
  }
  if (ERC20USDCaddr == '') {
    throw("ERROR: no address set for USDC");
  }

  console.log("DEPLOYING HolyPool ASSET POOL, network=" + network)

  const holyPoolInstance = await deployProxy(HolyPool, [ERC20USDCaddr], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyPool asset pool deployed at address: ', holyPoolInstance.address);

  // set transfer proxy for holypool
  await holyPoolInstance.setTransferProxy.sendTransaction(holyHandaddr, { from: founderaddr });
  console.log('HolyPool has HolyHand address set for deposits/withdrawals');
};
