// migrations/19_upgrade_hhtoken_mover.js
const HHTokenV2 = artifacts.require('HHTokenV2');
const MoverToken = artifacts.require('MoverToken');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let HHaddr = (await HHTokenV2.deployed()).address;
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else {
    founderaddr = accounts[0];
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (HHaddr == '') {
    throw("ERROR: no HH token address present to upgrade");
  }

  console.log("UPGRADING HH TOKEN V2 TO MOVER TOKEN at address " + HHaddr + " IN network=" + network)
  
  const upgradedTokenInstance = await upgradeProxy(HHaddr, MoverToken, { unsafeAllowCustomTypes: true });
  console.log('Mover token upgraded at address: ', upgradedTokenInstance.address);
  if (upgradedTokenInstance.address != HHaddr) {
      console.log('ERROR: Token address changed during upgrade, this should not happen');
  }
};