// migrations/15_upgrade_holypoolV2.js
const HolyPool = artifacts.require('HolyPool');
const HolyPoolV2 = artifacts.require('HolyPoolV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyPooladdr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyPooladdr = (await HolyPool.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyPooladdr = (await HolyPool.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyPooladdr = (await HolyPool.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyPooladdr == '') {
    throw("ERROR: no HolyPool address present to upgrade");
  }

  console.log("UPGRADING HOLYPOOL TO V2 at address " + holyPooladdr + " IN network=" + network)
  
  const upgradedPoolInstance = await upgradeProxy(holyPooladdr, HolyPoolV2, { unsafeAllowCustomTypes: true });
  console.log('HolyPool upgraded at address: ', upgradedPoolInstance.address);
  if (upgradedPoolInstance.address != holyPooladdr) {
      console.log('ERROR: HolyPool address changed during upgrade, this should not happen');
  }

  // HolyPool upgrade requires no maintenance calls after upgrade
};