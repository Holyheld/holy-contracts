// migrations/20_deploy_holywingV3.js
var HolyWingV3 = artifacts.require("HolyWingV3.sol");

module.exports = async function(deployer, network, accounts) {
  let founderaddr = "";
  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566";
  } else if (network == "ropsten" || network == "ropsten-fork") {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else if (network == "kovan" || network == "kovan-fork") {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else {
    founderaddr = accounts[0];
  }

  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }

  await Promise.all([
    deployer.deploy(HolyWingV3, {from: founderaddr}),
  ]);
};
