var Holy = artifacts.require("./HolyToken.sol");

module.exports = async function(deployer, network, accounts) {
  const treasuryaddr = accounts[1];
  await Promise.all([
    deployer.deploy(Holy, treasuryaddr, {gas: 10000000}),
  ]);
};
