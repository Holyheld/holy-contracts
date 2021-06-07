// migrations/25_upgrade_smarttreasuryV2.js
const SmartTreasury = artifacts.require('SmartTreasury');
const SmartTreasuryV2 = artifacts.require('SmartTreasuryV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  let founderaddr = "";
  let STaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    STaddr = (await SmartTreasury.deployed()).address;
  } else {
    founderaddr = accounts[0];
    STaddr = (await SmartTreasury.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (STaddr == '') {
    throw("ERROR: no SmartTreasury address present to upgrade");
  }


  console.log("UPGRADING SMART TREASURY at address " + STaddr + " IN network=" + network)
  
  const upgradedSTInstance = await upgradeProxy(STaddr, SmartTreasuryV2, { unsafeAllowCustomTypes: true });
  console.log('SmartTreasury upgraded at address: ', upgradedSTInstance.address);
  if (upgradedSTInstance.address != STaddr) {
      console.log('ERROR: SmartTreasury address changed during upgrade, this should not happen');
  }
};
