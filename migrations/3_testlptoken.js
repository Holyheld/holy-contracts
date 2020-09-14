var TelpLPToken = artifacts.require("./TestLPToken.sol");

module.exports = async function(deployer, network, accounts) {
  await Promise.all([
    deployer.deploy(TelpLPToken, {gas: 10000000}),
  ]);
};
