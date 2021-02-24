// migrations/14_upgrade_holypassageV4.js
const HolyPassage = artifacts.require('HolyPassageV3');
const HolyPassageV4 = artifacts.require('HolyPassageV4');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyPassageaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyPassageaddr = (await HolyPassage.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyPassageaddr = (await HolyPassage.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyPassageaddr = (await HolyPassage.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyPassageaddr == '') {
    throw("ERROR: no HolyPassage address present to upgrade");
  }

  console.log("UPGRADING HOLYPASSAGE TO V4 at address " + holyPassageaddr + " IN network=" + network)
  
  const upgradedPassageInstance = await upgradeProxy(holyPassageaddr, HolyPassageV4, { unsafeAllowCustomTypes: true });
  console.log('HolyPassage upgraded at address: ', upgradedPassageInstance.address);
  if (upgradedPassageInstance.address != holyPassageaddr) {
      console.log('ERROR: HolyPassage address changed during upgrade, this should not happen');
  }
};