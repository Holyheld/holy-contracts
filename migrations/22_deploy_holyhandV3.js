// migrations/22_deploy_holyhandV3.js
const HolyHandV2 = artifacts.require('HolyHandV2');
const HolyHandV3 = artifacts.require('HolyHandV3');
const SmartTreasury = artifacts.require('SmartTreasury');
const MoverToken = artifacts.require('MoverToken');

const { upgradeProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyhandaddr = "";
  let staddr = "";
  let moveaddr = "";
  let movelpaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyhandaddr = (await HolyHandV2.deployed()).address;
    staddr = (await SmartTreasury.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
    movelpaddr = "0x87b918e76c92818DB0c76a4E174447aeE6E6D23f";
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyhandaddr = (await HolyHandV2.deployed()).address;6
    staddr = (await SmartTreasury.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    // deploy mocked MOVE-LP token
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyhandaddr = (await HolyHandV2.deployed()).address;
    staddr = (await SmartTreasury.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
    movelpaddr = "0x4f96fe3b7a6cf9725f59d353f723c1bdb64ca6aa"; // we'll use kovan-DAI for tests
  } else {
    founderaddr = accounts[0];
    holyhandaddr = (await HolyHandV2.deployed()).address;
    staddr = (await SmartTreasury.deployed()).address;
    moveaddr = (await MoverToken.deployed()).address;
    const MockDAI = artifacts.require('ERC20DAIMock'); // deploy DAI mock to server as MOVE-ETH lp token
    await Promise.all([
      deployer.deploy(MockDAI, accounts[0], {gas: 7000000, from: accounts[0] }),
    ]);
    movelpaddr = (await MockDAI.deployed()).address;
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (holyhandaddr == '') {
    throw("ERROR: no HolyHand V2 address present to upgrade");
  }
  if (staddr == '') {
    throw("ERROR: no SmartTreasury address provided");
  }
  if (moveaddr == '') {
    throw("ERROR: no Mover token address provided");
  }
  if (movelpaddr == '') {
    throw("ERROR: no Mover-ETH LP token address provided");
  }

  console.log("UPGRADING HOLYHAND TO V3 at address " + holyhandaddr + " IN network=" + network)
  
  const upgradedHolyHandInstance = await upgradeProxy(holyhandaddr, HolyHandV3, { unsafeAllowCustomTypes: true });
  console.log('HolyHand upgraded at address: ', upgradedHolyHandInstance.address);
  if (upgradedHolyHandInstance.address != holyhandaddr) {
      console.log('ERROR: HolyHand address changed during upgrade, this should not happen');
  }

  await upgradedHolyHandInstance.setSmartTreasury.sendTransaction(staddr);
  console.log('HolyHand setSmartTreasury set to address: ', staddr);
  await upgradedHolyHandInstance.setTreasuryTokens.sendTransaction(moveaddr, movelpaddr);
  console.log('HolyHand SmartTreasury tokens set to address1: ', moveaddr, ' address2: ', movelpaddr);

  // Note: HolyHand V3 upgrade would require setting TRUSTED_EXECUTION role for EOA serving as trusted executor wallets
};
