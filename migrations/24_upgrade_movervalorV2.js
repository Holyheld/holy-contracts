// migrations/24_upgrade_movervalorV2.js
const MoverValor = artifacts.require('MoverValorYearnUSDCv2Vault');
const MoverValorV2 = artifacts.require('MoverValorYearnUSDCv2VaultV2');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  if (network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork") {
    return; // skip this migration for testnets
  }

  let founderaddr = "";
  let moverValoraddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    moverValoraddr = (await MoverValor.deployed()).address;
  } else {
    founderaddr = accounts[0];
    moverValoraddr = (await MoverValor.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (moverValoraddr == '') {
    throw("ERROR: no MoverValor address present to upgrade");
  }


  console.log("UPGRADING MOVER VALOR at address " + moverValoraddr + " IN network=" + network)
  
  const upgradedValorInstance = await upgradeProxy(moverValoraddr, MoverValorV2, { unsafeAllowCustomTypes: true });
  console.log('MoverValor upgraded at address: ', upgradedValorInstance.address);
  if (upgradedValorInstance.address != moverValoraddr) {
      console.log('ERROR: MoverValor address changed during upgrade, this should not happen');
  }
};
