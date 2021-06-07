// migrations/13_upgrade_holyvalorUSDCVault.js
const HolyValor = artifacts.require('HolyValorYearnUSDCVault');
const HolyValorV2 = artifacts.require('HolyValorYearnUSDCVaultV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  if (network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork") {
    return; // skip this migration for testnets
  }

  
  let founderaddr = "";
  let holyValoraddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyValoraddr = (await HolyValor.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyValoraddr = (await HolyValor.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyValoraddr = (await HolyValor.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyValoraddr == '') {
    throw("ERROR: no HolyValor address present to upgrade");
  }


  console.log("UPGRADING HOLYVALOR at address " + holyValoraddr + " IN network=" + network)
  
  const upgradedValorInstance = await upgradeProxy(holyValoraddr, HolyValorV2, { unsafeAllowCustomTypes: true });
  console.log('HolyValor upgraded at address: ', upgradedValorInstance.address);
  if (upgradedValorInstance.address != holyValoraddr) {
      console.log('ERROR: HolyValor address changed during upgrade, this should not happen');
  }
};