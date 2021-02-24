// migrations/4_test_holypassage_migrator.js
const HolyPassage = artifacts.require('HolyPassage');
const HolyPassageV2 = artifacts.require('HolyPassageV2');
const HolyToken = artifacts.require('HolyToken');
const HHToken = artifacts.require('HHToken');

const { deployProxy } = require('@openzeppelin/truffle-upgrades');
 
module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let holyV1addr = "";
  let holyV2addr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    holyV1addr = "0x39eAE99E685906fF1C11A962a743440d0a1A6e09";
    holyV2addr = (await HHToken.deployed()).address;
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
  } else {
    founderaddr = accounts[0];
    holyV1addr = (await HolyToken.deployed()).address;
    holyV2addr = (await HHToken.deployed()).address;
  }

  console.log("DEPLOYING HOLYPASSAGE, network=" + network)
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

  let tokenInstance;

  if (network == "develop" || network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    tokenInstance = await deployProxy(HolyPassage, [holyV1addr, holyV2addr], { unsafeAllowCustomTypes: true, from: founderaddr });
    console.log('HolyPassage deployed at address: ', tokenInstance.address);
  } else if (network == "live" || network == "live-fork") {
    tokenInstance = await deployProxy(HolyPassageV2, [holyV1addr, holyV2addr], { unsafeAllowCustomTypes: true, from: founderaddr });
    console.log('HolyPassage V2 deployed at address: ', tokenInstance.address);
  }

  //could we provide right to mint to this contract by calling the HH token mint interface?
  let hhtokenInstance = await HHToken.at(holyV2addr);
  const minter_role = await hhtokenInstance.MINTER_ROLE();

  let default_admin_role = await hhtokenInstance.DEFAULT_ADMIN_ROLE();
  const hasRole = await hhtokenInstance.hasRole(default_admin_role, founderaddr, { from: founderaddr });
  console.log("DEPLOYER HH TOKEN HAS ADMIN RIGHTS:" + hasRole);

  let default_admin_role2 = await tokenInstance.DEFAULT_ADMIN_ROLE();
  const hasRole2 = await tokenInstance.hasRole(default_admin_role2, founderaddr, { from: founderaddr });
  console.log("DEPLOYER HOLYPASSAGE HAS ADMIN RIGHTS:" + hasRole2);

  await hhtokenInstance.grantRole.sendTransaction(minter_role, tokenInstance.address, { from: founderaddr });
  console.log('Minter role granted to HolyPassage for HH token');
};
