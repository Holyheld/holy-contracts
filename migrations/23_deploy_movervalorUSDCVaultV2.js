// migrations/23_deploy_movervalorUSDCVaultV2.js
const MoverValor = artifacts.require('MoverValorYearnUSDCv2Vault');
const HolyPool = artifacts.require('HolyPool');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let ERC20USDCaddr = "";
  let pooladdr = (await HolyPool.deployed()).address;
  var vaultv2addr = "";

  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    ERC20USDCaddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // base asset
    vaultv2addr = "0x5f18C75AbDAe578b483E5F43f12a39cF75b973a9";  
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
    const VaultMock = artifacts.require('InvestmentVaultYUSDCv2Mock');
    const VaultMockInstance = await deployer.deploy(VaultMock, ERC20USDCaddr);
    await USDCMockInstance.approve.sendTransaction(VaultMockInstance.address, web3.utils.toBN('1000000000000000'), { from: accounts[9] });
    await USDCMockInstance.transfer(accounts[9], web3.utils.toBN('1000000000000'), { from: accounts[0] });
    await VaultMockInstance.setStash(accounts[9]);
    vaultv2addr = VaultMockInstance.address;
  }

  if (network == "ropsten" || network == "ropsten-fork" || network == "kovan" || network == "kovan-fork") {
    return; // skip this migration for testnets
  }


  if (founderaddr == '') {
    throw("ERROR: no address set for founder");
  }
  if (ERC20USDCaddr == '') {
    throw("ERROR: no address set for USDC");
  }
  if (pooladdr == '') {
    throw("ERROR: no address set for HolyPool");
  }
  if (vaultv2addr == '') {
    throw("ERROR: no address set for USDC Vault");
  }


  console.log("DEPLOYING MoverValor (USDCv2 Vault) INVEST PROXY, network=" + network)

  const moverValorInstance = await deployProxy(MoverValor, [ERC20USDCaddr, vaultv2addr, pooladdr], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('MoverValor (USDCv2 Vault) invest proxy deployed at address: ', moverValorInstance.address);

  // aftercare:
  // add MoverValor to HolyPool
  // let holyPoolInstance = await HolyPool.at(pooladdr);
  // await holyPoolInstance.addHolyValor.sendTransaction(moverValorInstance.address, { from: accounts[0] });
  // console.log('MoverValor added to HolyPool to get funds access for investing');
  //            call movervalor.setPool
  //            call movervalor.setYieldDistributor
};
