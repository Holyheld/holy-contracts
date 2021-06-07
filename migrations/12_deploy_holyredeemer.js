// migrations/12_deploy_holyredeemer.js
const HolyRedeemer = artifacts.require('HolyRedeemer');
const HolyHand = artifacts.require('HolyHand');
const HolyPool = artifacts.require('HolyPool');
const HolyValor = artifacts.require('HolyValorYearnUSDCVault');

const { deployProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {

  if (network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork") {
    return; // skip this migration for testnets
  }


  let founderaddr = "";
  let ERC20USDCaddr = "";
  let pooladdr = (await HolyPool.deployed()).address;
  let valoraddr = (await HolyValor.deployed()).address;
  let holyhandaddr = (await HolyHand.deployed()).address;
  let treasuryaddr = "";
  let operationsaddr = "";

  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    ERC20USDCaddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // base asset
    treasuryaddr = "0xf6A0307cb6aA05D7C19d080A0DA9B14eAB1050b7";
    operationsaddr = "0xf6A0307cb6aA05D7C19d080A0DA9B14eAB1050b7";
  } else if (network == "ropsten" || network == "ropsten-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
  } else if (network == "kovan" || network == "kovan-fork" /* for dry-run */) {
    founderaddr = "0x9EDfA914175FD5580c80e329F7dE80654E8d63e1";
    ERC20USDCaddr = "0x75b0622cec14130172eae9cf166b92e5c112faff";
  } else {
    founderaddr = accounts[0];
    const ERC20USDCMock = artifacts.require('ERC20USDCMock');
    const USDCMockInstance = await deployer.deploy(ERC20USDCMock, founderaddr);
    ERC20USDCaddr = USDCMockInstance.address;
    treasuryaddr = accounts[8];
    operationsaddr = accounts[9];
  }


  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (ERC20USDCaddr == '') {
    throw("ERROR: no address set for USDC");
  }
  if (holyhandaddr == '') {
    throw("ERROR: no address set for HolyHand");
  }
  if (pooladdr == '') {
    throw("ERROR: no address set for HolyPool");
  }
  if (valoraddr == '') {
    throw("ERROR: no address set for HolyValor");
  }
  if (treasuryaddr == '') {
    throw("ERROR: no address set for HolyTreasury");
  }
  if (operationsaddr == '') {
    throw("ERROR: no address set for operations wallet");
  }

  console.log("DEPLOYING HolyRedeemer YIELD DISTRIBUTOR, network=" + network)

  const holyRedeemerInstance = await deployProxy(HolyRedeemer, [], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyRedeemer yield distributor deployed at address: ', holyRedeemerInstance.address);

  // set HolyRedeemer as yield distributor for HolyHand (USDC token) and HolyValor
  let holyValorInstance = await HolyValor.at(valoraddr);
  await holyValorInstance.setYieldDistributor.sendTransaction(holyRedeemerInstance.address, { from: accounts[0] });
  console.log('HolyRedeemer added as yield distributor to HolyValor');

  let holyHandInstance = await HolyHand.at(holyhandaddr);
  await holyHandInstance.setYieldDistributor.sendTransaction(ERC20USDCaddr, holyRedeemerInstance.address, { from: accounts[0] });
  console.log('HolyRedeemer added as yield distributor to HolyHand');

  // set addresses for yield distribution
  await holyRedeemerInstance.setPoolAddress.sendTransaction(pooladdr, { from: accounts[0] });
  console.log('HolyRedeemer HolyPool address set to ' + pooladdr);

  await holyRedeemerInstance.setTreasuryAddress.sendTransaction(treasuryaddr, { from: accounts[0] });
  console.log('HolyRedeemer treasury address set to ' + treasuryaddr);

  await holyRedeemerInstance.setOperationsAddress.sendTransaction(operationsaddr, { from: accounts[0] });
  console.log('HolyRedeemer operations address set to ' + operationsaddr);
};
