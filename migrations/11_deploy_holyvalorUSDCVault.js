// migrations/11_deploy_holyvalorUSDCVault.js
const HolyValor = artifacts.require('HolyValorYearnUSDCVault');
const HolyPool = artifacts.require('HolyPool');
 
const { deployProxy } = require('@openzeppelin/truffle-upgrades');

module.exports = async function (deployer, network, accounts) {
  let founderaddr = "";
  let ERC20USDCaddr = "";
  let pooladdr = (await HolyPool.deployed()).address;
  var vaultaddr = "";

  if (network == "live" || network == "live-fork") {
    founderaddr = "0xb754601d2C8C1389E6633b1449B84CcE57788566"; // HolyHeld deployer
    ERC20USDCaddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // base asset
    vaultaddr = "0x597aD1e0c13Bfe8025993D9e79C69E1c0233522e";  
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
    const VaultMock = artifacts.require('InvestmentVaultYUSDCMock');
    const VaultMockInstance = await deployer.deploy(VaultMock, ERC20USDCaddr);
    await USDCMockInstance.approve.sendTransaction(VaultMockInstance.address, web3.utils.toBN('1000000000000000'), { from: accounts[9] });
    await USDCMockInstance.transfer(accounts[9], web3.utils.toBN('1000000000000'), { from: accounts[0] });
    await VaultMockInstance.setStash(accounts[9]);
    vaultaddr = VaultMockInstance.address;
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
  if (vaultaddr == '') {
    throw("ERROR: no address set for USDC Vault");
  }

  console.log("DEPLOYING HolyValor INVEST PROXY, network=" + network)

  const holyValorInstance = await deployProxy(HolyValor, [ERC20USDCaddr, vaultaddr, pooladdr], { unsafeAllowCustomTypes: true, from: founderaddr });
  console.log('HolyValor invest proxy deployed at address: ', holyValorInstance.address);

  // add HolyValor to HolyPool
  let holyPoolInstance = await HolyPool.at(pooladdr);
  await holyPoolInstance.addHolyValor.sendTransaction(holyValorInstance.address, { from: accounts[0] });
  console.log('HolyValor added to HolyPool to get funds access for investing');
};
