// migrations/8_deploy_holyhand.js
const HolyHand = artifacts.require('HolyHand');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
 
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
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
  
  console.log("DEPLOYING HolyHand TRANSFER PROXY, network=" + network)

  const holyHandInstance = await deployProxy(HolyHand, [], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyHand transfer proxy deployed at address: ', holyHandInstance.address);
};
