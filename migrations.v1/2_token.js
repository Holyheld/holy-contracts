var Holy = artifacts.require("./HolyToken.sol");

module.exports = async function(deployer, network, accounts) {
  const founderaddr = accounts[1];
  const treasuryaddr = accounts[2];
  await Promise.all([
    deployer.deploy(Holy, founderaddr, treasuryaddr, {gas: 10000000}),
  ]);
};
