// migrations/17_upgrade_holywingV2.js
const HolyHand = artifacts.require('HolyHandV2');
const HolyWing = artifacts.require('HolyWing');
const HolyWingV2 = artifacts.require('HolyWingV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyWingaddr = "";
  let holyHandaddr = (await HolyHand.deployed()).address;
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyWingaddr = (await HolyWing.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyWingaddr = (await HolyWing.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyWingaddr = (await HolyWing.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyWingaddr == '') {
    throw("ERROR: no HolyWing address present to upgrade");
  }
  if (holyHandaddr == '') {
    throw("ERROR: no address set for HolyHand");
  }

  console.log("UPGRADING HOLYWING TO V2 at address " + holyWingaddr + " IN network=" + network)
  
  const upgradedHolyWingInstance = await upgradeProxy(holyWingaddr, HolyWingV2, { unsafeAllowCustomTypes: true });
  console.log('HolyWing upgraded at address: ', upgradedHolyWingInstance.address);
  if (upgradedHolyWingInstance.address != holyWingaddr) {
      console.log('ERROR: HolyWing address changed during upgrade, this should not happen');
  }

  // HolyWing V2 requires transferProxy to be set to be able to execute swaps for security reasons
  await upgradedHolyWingInstance.setTransferProxy.sendTransaction(holyHandaddr, { from: accounts[0] });
  console.log('HolyWing transferProxy set to HolyHand address at ' + holyHandaddr);
};