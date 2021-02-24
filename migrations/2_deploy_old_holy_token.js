// migrations/2_deploy_old_holy_token.js
var HolyToken = artifacts.require("HolyToken.sol");

module.exports = async function(deployer, network, accounts) {
  let founderaddr = "";
  if (network == "live" || network == "live-fork") {
    // in live network the token is already deployed in other project
    console.log("Holy V1 token is already deployed in mainnet, skipping this step");
    return;
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
    deployer.deploy(HolyToken, founderaddr, founderaddr, {gas: 7000000}),
  ]);
};
