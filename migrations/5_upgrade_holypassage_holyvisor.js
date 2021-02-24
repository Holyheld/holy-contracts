// migrations/5_upgrade_holypassage_holyvisor.js
const HolyPassage = artifacts.require('HolyPassage');
const HolyPassageV2 = artifacts.require('HolyPassageV2');
const HolyVisor = artifacts.require('HolyVisor');
const HolyToken = artifacts.require('HolyToken');
const HHToken = artifacts.require('HHToken');

const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades');

// we would upgrade HolyPassage contract in Ropsten (to test upgrades)
// and skip upgrade in live network (file was changed in place) and local0 develop
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyV1addr = "";
  let holyV2addr = "";
  let holyPassageaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyV1addr = "0x39eAE99E685906fF1C11A962a743440d0a1A6e09";
    holyV2addr = (await HHToken.deployed()).address;
    holyPassageaddr = (await HolyPassageV2.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
    holyPassageaddr = (await HolyPassage.deployed()).address;
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
    holyPassageaddr = (await HolyPassage.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
    holyPassageaddr = (await HolyPassage.deployed()).address;
  }

  if (network == "develop" || network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    console.log("UPGRADING HOLYPASSAGE at address " + holyPassageaddr + " IN network=" + network)
    console.log("HOLY Token (v1) address: " + holyV1addr);
    console.log("HH Token (v2) address: " + holyV2addr);
    if (founderaddr == '') {
        throw("ERROR: no address set for founder");
    }
    if (holyV1addr == '') {
        throw("ERROR: no address set for HOLY V1 token");
    }
    if (holyV2addr == '') {
        throw("ERROR: no address set for HH V2 token");
    }
    if (holyPassageaddr == '') {
        throw("ERROR: no HolyPassage address present to upgrade");
    }

    let holyPassageV1Instance = await HolyPassage.at(holyPassageaddr);
    const default_admin_role = await holyPassageV1Instance.DEFAULT_ADMIN_ROLE();
    const hasRole = await holyPassageV1Instance.hasRole(default_admin_role, founderaddr, { from: founderaddr });
    console.log("HAS ADMIN RIGHTS:" + hasRole);
    await holyPassageV1Instance.hasRole.sendTransaction(default_admin_role, founderaddr, { from: founderaddr });
    console.log('Default admin role granted on HolyPassage for deployer address');
  
    const upgradedInstance = await upgradeProxy(holyPassageaddr, HolyPassageV2, { unsafeAllowCustomTypes: true });
    console.log('HolyPassage upgraded at address: ', upgradedInstance.address);
    if (upgradedInstance.address != holyPassageaddr) {
        console.log('ERROR: HolyPassage address changed during upgrade, this should not happen');
    }
  } else {
      console.log("Network is not develop/Ropsten testnet, skipping HolyPassage upgrade");
  }

  // deploy HolyVisor contract (do not populate any data)
  console.log("DEPLOYING HolyVisor, network=" + network)
  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }

  const holyVisorInstance = await deployProxy(HolyVisor, [], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyVisor deployed at address: ', holyVisorInstance.address);

  //could we provide right to mint to this contract by calling the HH token mint interface?
  let holyPassageInstance = await HolyPassageV2.at(holyPassageaddr);
  await holyPassageInstance.setHolyVisor.sendTransaction(holyVisorInstance.address, { from: founderaddr });
  console.log('HolyPassage has HolyVisor address set for bonus data calculations');
};