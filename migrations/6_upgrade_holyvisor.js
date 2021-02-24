// migrations/6_upgrade_holyvisor.js
const HolyVisor = artifacts.require('HolyVisor');
const HolyVisorV2 = artifacts.require('HolyVisorV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyVisoraddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyVisoraddr = (await HolyVisor.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyVisoraddr = (await HolyVisor.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyVisoraddr = (await HolyVisor.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyVisoraddr == '') {
    throw("ERROR: no HolyVisor address present to upgrade");
  }

  console.log("UPGRADING HOLYVISOR at address " + holyVisoraddr + " IN network=" + network)
  
  const upgradedVisorInstance = await upgradeProxy(holyVisoraddr, HolyVisorV2, { unsafeAllowCustomTypes: true });
  console.log('HolyVisor upgraded at address: ', upgradedVisorInstance.address);
  if (upgradedVisorInstance.address != holyVisoraddr) {
      console.log('ERROR: HolyVisor address changed during upgrade, this should not happen');
  }
};