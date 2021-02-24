// migrations/9_deploy_holywing.js
const HolyWing = artifacts.require('HolyWing');
const HolyHand = artifacts.require('HolyHand');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
 
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyHandaddr = (await HolyHand.deployed()).address;
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else {
    founderaddr = accounts[0];
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyHandaddr == '') {
    throw("ERROR: no address set for HolyHand");
  }

  console.log("DEPLOYING HolyWing EXCHANGE PROXY, network=" + network)

  const holyWingInstance = await deployProxy(HolyWing, [], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyWing exchange proxy deployed at address: ', holyWingInstance.address);

  // set exchange proxy for holyhand
  let holyHandInstance = await HolyHand.at(holyHandaddr);
  await holyHandInstance.setExchangeProxy.sendTransaction(holyWingInstance.address, { from: founderaddr });
  console.log('HolyHand has HolyWing address set for providing token swap capabilities');
};
