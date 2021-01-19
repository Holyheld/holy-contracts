// migrations/3_deploy_upgradeable_hh_token.js
const HHToken = artifacts.require('HHToken');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
 
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    // this should be covered by migrations properly and not redeployed
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else {
    founderaddr = accounts[0];
  }

  console.log("DEPLOYING HH TOKEN, network=" + network)
  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }

  const tokenInstance = await deployProxy(HHToken, ["Holyheld", "HH"], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HH Token deployed at address: ', tokenInstance.address);
};
