// test/InvestmentFlowFuzz.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const HolyHand = artifacts.require('HolyHandV2');
const HolyPool = artifacts.require('HolyPoolV2');
const HolyWing = artifacts.require('HolyWingV2');
const HolyValor = artifacts.require('HolyValorYearnUSDCVaultV2');
const HolyRedeemer = artifacts.require('HolyRedeemer');

const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockVaultUSDC = artifacts.require('InvestmentVaultYUSDCMock');
const MockTokenSwapExecutorMock = artifacts.require('TokenSwapExecutorMock');

function BN2hex256(bn){
    var dec = bn.toString().split(''), sum = [], hex = [], i, s
    while(dec.length){
        s = 1 * dec.shift()
        for(i = 0; s || i < sum.length; i++){
            s += (sum[i] || 0) * 10
            sum[i] = s % 16
            s = (s - sum[i]) / 16
        }
    }
    while(sum.length){
        hex.push(sum.pop().toString(16))
    }
    hexstr = hex.join('');
    while (hexstr.length < 64) {
		hexstr = "0" + hexstr;
    }
    return "0x" + hexstr;
}

contract('HolyPool/HolyValor/HolyRedeemer random tests', function (accounts) {
    // test multiple deposits, withdraws, harvests
    it('HolyPool/HolyValor/HolyRedeemer random operations tests', async function() {
        this.timeout(1200000); // yes, such test is going to take a while

        // The goal is to check:
        // - if numbers stay in expected range;
        // - if multiple actions processed as expected;
        // scenarios generated:
        // - account 0 is deployer address;
        // - accounts 1,2,3 are investors;
        // - account 5 is treasury address;
        // - account 6 is operations wallet;
        // available are deposits with DAI (conversion rate is 0.9) or USDC (no conversion)
        // events are generated at random:
        // - account is depositing X;
        // - account is withdrawing X (safe amount);
        // - account is withdrawing X (fee occures);
        // - valor is taking available balance to invest;
        // - valor is returning back portion of balance to pool;
        // - vault is earning and yield is distributed;
        // JS variables are used to track numbers
        // DAI quantities would be multiplied and converted to BN before calls
        // between every action 6 hours inverval is passed

        this.prepareCleanDeployment = async function () {    
            // deploy tokens, exchange and vault mock contracts
            this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });
            this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
            this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
            this.mockvault = await MockVaultUSDC.new(this.mockusdc.address, { from: accounts[0] });
            await this.mockusdc.approve.sendTransaction(this.mockvault.address, web3.utils.toBN('1000000000000000000'), { from: accounts[9] });
            await this.mockusdc.transfer(accounts[9], web3.utils.toBN('500000000000'), { from: accounts[0] });
            await this.mockvault.setStash(accounts[9]);
        
            // deploy HolyHand transfer proxy
            this.holyhand = await deployProxy(HolyHand, { unsafeAllowCustomTypes: true, from: accounts[0] });
    
            // deploy HolyWing exchange middleware
            this.holywing = await deployProxy(HolyWing, { unsafeAllowCustomTypes: true, from: accounts[0] });
            await this.holyhand.setExchangeProxy.sendTransaction(this.holywing.address, { from: accounts[0] });
            await this.holywing.setTransferProxy(this.holyhand.address);

            // deploy HolyPool and connect to transfer proxy HolyHand
            this.holypool = await deployProxy(HolyPool, [ this.mockusdc.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
            await this.holypool.setTransferProxy.sendTransaction(this.holyhand.address, { from: accounts[0] });
            await this.holypool.setReserveTarget.sendTransaction(web3.utils.toBN('7500000'), { from: accounts[0] }); // USDC has 6 decimals
    
            // deploy HolyValor and connect it to HolyPool
            this.holyvalor = await deployProxy(HolyValor, [ this.mockusdc.address, this.mockvault.address, this.holypool.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
            await this.holypool.addHolyValor.sendTransaction(this.holyvalor.address, { from: accounts[0] });
    
            // deploy HolyRedeemer and connect to HolyValor
            this.holyredeemer = await deployProxy(HolyRedeemer, [], { unsafeAllowCustomTypes: true, from: accounts[0] });
            await this.holyvalor.setYieldDistributor.sendTransaction(this.holyredeemer.address, { from: accounts[0] });
            await this.holyredeemer.setPoolAddress.sendTransaction(this.holypool.address, { from: accounts[0] });
            await this.holyredeemer.setTreasuryAddress.sendTransaction(accounts[5], { from: accounts[0] });
            await this.holyredeemer.setOperationsAddress.sendTransaction(accounts[6], { from: accounts[0] });
            await this.holyredeemer.setTreasuryPercentage.sendTransaction(web3.utils.toBN('2500000000000000000'), { from: accounts[0] });
            await this.holyredeemer.setOperationsPercentage.sendTransaction(web3.utils.toBN('7500000000000000000'), { from: accounts[0] });
    
            // approve HolyHand for USDC and DAI for 3 accounts
            await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
            await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[2] });
            await this.mockdai.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[3] });
            await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
            await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[2] });
            await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[3] });

            // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
            await time.advanceBlock();
        };

        const totalScenarios = 1
        for (var i = 0; i < totalScenarios; i++) {
            const pad = '        ';
            console.log(pad + 'Step ' + (i+1) + "/" + totalScenarios);
            await this.prepareCleanDeployment();

            // we count in JS amounts as 6 decimals as USDC has
            // give each account from 1 to 100 USDC/DAI
            var account1balanceUSDC = Math.floor(Math.random() * 99000000) + 1000000;
            var account1balanceDAI = Math.floor(Math.random() * 99000000) + 1000000;
            var account2balanceUSDC = Math.floor(Math.random() * 99000000) + 1000000;
            var account2balanceDAI = Math.floor(Math.random() * 99000000) + 1000000;
            var account3balanceUSDC = Math.floor(Math.random() * 99000000) + 1000000;
            var account3balanceDAI = Math.floor(Math.random() * 99000000) + 1000000;

            var account1startUSDC = account1balanceUSDC;
            var account1startDAI = account1balanceDAI;
            var account2startUSDC = account2balanceUSDC;
            var account2startDAI = account2balanceDAI;
            var account3startUSDC = account3balanceUSDC;
            var account3startDAI = account3balanceDAI;

            var poolReserveTarget = 7500000;

            // control metrics
            var account1invested = 0;
            var account2invested = 0;
            var account3invested = 0;
            // shares quantity of accounts in HolyPool
            var account1shares = 0;
            var account2shares = 0;
            var account3shares = 0;

            var poolBalance = 0;    // pool reserve
            var poolTotalAssets = 1000000;   // total assets in USDC (it has start amount)
            var poolTotalShares = 1000000;
            var poolPricePerShare = 1.0;
            var poolAPY = 0.0;

            var valorContractBalance = 0;   // unclaimed yield
            var valorBalance = 0;   // invested capital body
            var valorShares = 0;

            var treasuryBalance = 0;
            var operationsBalance = 0;

            var vaultBalance = 1000000; // vault has start amount of 1 balance
            var vaultTotalShares = 1000000;

            var totalVaultEarnings = 0; // for report

            expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

            // send USDC and DAI to accounts
            await this.mockusdc.transfer(accounts[1], web3.utils.toBN(account1balanceUSDC), { from: accounts[0]} );
            await this.mockusdc.transfer(accounts[2], web3.utils.toBN(account2balanceUSDC), { from: accounts[0]} );
            await this.mockusdc.transfer(accounts[3], web3.utils.toBN(account3balanceUSDC), { from: accounts[0]} );
            await this.mockdai.transfer(accounts[1], web3.utils.toBN(account1balanceDAI).imuln(1000000).imuln(1000000), { from: accounts[0]} );
            await this.mockdai.transfer(accounts[2], web3.utils.toBN(account2balanceDAI).imuln(1000000).imuln(1000000), { from: accounts[0]} );
            await this.mockdai.transfer(accounts[3], web3.utils.toBN(account3balanceDAI).imuln(1000000).imuln(1000000), { from: accounts[0]} );
            // transfer 200K USDC to swap executor and the rest of USDC to vault mock to have additional balance
            await this.mockusdc.transfer(this.mockexecutor.address, web3.utils.toBN('200000000000'), { from: accounts[0] });
            //await this.mockusdc.transfer(this.mockvault.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

            // roll the dice N times, simulate event and calculate expected amounts on client-side
            for (var t = 0; t < 1000; t++) {
                const action = Math.floor(Math.random() * 13);
                // 0-2 USDC deposit
                // 3-5 DAI deposit
                // 6-8 pool withdrawal
                // 9 valor invest
                // 10 valor divest
                // 11 vault yield gain

                switch(action) {
                    case 0:
                    case 1:
                    case 2:
                        // deposit USDC
                        const acc = action % 3;
                        const amountCap = (acc === 0 ? account1balanceUSDC : (acc === 1 ? account2balanceUSDC : account3balanceUSDC));
                        if (amountCap < 100) {
                            // account has not enough funds available, cannot deposit
                            // TODO: catch a revert here
                            console.log(pad + pad + t + ': Account ' + acc + ' has <0.0001 USDC to deposit, skipping');
                            break;
                        }
                        var amount = Math.floor(Math.random() * (amountCap - 100)) + 100;
                        console.log(pad + pad + t + ': Account ' + acc + ' deposits ' + (amount/1000000.0) + ' USDC to HolyPool');
                        console.log(pad + pad + pad + 'pool price per share:' + poolPricePerShare);

                        // perform deposit without tokens exchange
                        var sharesToAdd = Math.floor(amount / poolPricePerShare);
                        var expectedAmount = Math.floor(sharesToAdd * poolPricePerShare);

                        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN(amount), web3.utils.toBN('0'), [], { from: accounts[acc+1] });

                        if (acc === 0) {
                            account1balanceUSDC -= amount;
                            account1invested += expectedAmount;
                            account1shares += sharesToAdd;
                        } else if (acc === 1) {
                            account2balanceUSDC -= amount;
                            account2invested += expectedAmount;
                            account2shares += sharesToAdd;
                        } else {
                            account3balanceUSDC -= amount;
                            account3invested += expectedAmount;
                            account3shares += sharesToAdd;
                        }
                        poolBalance += amount;
                        
                        poolTotalAssets += amount; // there is a small discrepancy due to rounding error (but we still transfer whole amount to pool)

                        poolTotalShares += sharesToAdd;
                        break;
                    case 3:
                    case 4:
                    case 5:
                        // deposit DAI
                        const accDai = action % 3;
                        const amountCapDai = (accDai === 0 ? account1balanceDAI : (accDai === 1 ? account2balanceDAI : account3balanceDAI));
                        if (amountCapDai < 100) {
                            // account has not enough funds available, cannot deposit
                            // TODO: catch a revert here
                            console.log(pad + pad + t + ': Account ' + accDai + ' has <0.0001 DAI to deposit, skipping');
                            break;
                        }
                        var amount = Math.floor(Math.random() * (amountCapDai - 100)) + 100;
                        console.log(pad + pad + t + ': Account ' + accDai + ' deposits ' + (amount/1000000.0) + ' DAI to HolyPool');

                        // perform deposit with tokens exchange DAI->USDC at rate 0.9
                        const beforeAssets = (await this.holypool.totalAssetAmount()).toString();
                        const beforeBalance = (await this.mockdai.balanceOf(accounts[accDai+1])).toString();
                        //console.log("Pool assets before: " + beforeAssets + ", account balance=" + beforeBalance + " calc balance=" + amountCapDai);

                        var daiAmountWei = web3.utils.toBN(amount).imuln(1000000).imuln(1000000); // * 1e12 (18 decimals in token to convert from)
                        var minAmountExpected = web3.utils.toBN(amount).imuln(85).idivn(100); // 6 decimals in token to receive
                        const bytesData = [].concat(web3.utils.hexToBytes(this.mockexecutor.address), web3.utils.hexToBytes(this.mockexecutor.address), 
                            web3.utils.hexToBytes('0x0000000000000000000000000000000000000000000000000000000000000000'), 
                            web3.utils.hexToBytes('0xec6cc0cc000000000000000000000000'), //func hash + padding for address of token from
                            web3.utils.hexToBytes(this.mockdai.address),
                            web3.utils.hexToBytes('0x000000000000000000000000'), //padding for address of token to
                            web3.utils.hexToBytes(this.mockusdc.address),
                            web3.utils.hexToBytes(BN2hex256(daiAmountWei)));

                        var amountExpected = Math.floor(amount * 0.9); // 6 decimals in token to receive

                        var sharesToAdd = Math.floor(amountExpected / poolPricePerShare);
                        var amountExpectedViaShares = Math.floor(sharesToAdd * poolPricePerShare);

                        await this.holyhand.depositToPool(this.holypool.address, this.mockdai.address, web3.utils.toBN(daiAmountWei), minAmountExpected, bytesData, { from: accounts[accDai+1] });

                        const afterAssets = (await this.holypool.totalAssetAmount()).toString();

                        if (accDai === 0) {
                            account1balanceDAI -= amount;
                            account1invested += amountExpectedViaShares;
                            account1shares += sharesToAdd;
                        } else if (accDai === 1) {
                            account2balanceDAI -= amount;
                            account2invested += amountExpectedViaShares;
                            account2shares += sharesToAdd;
                        } else {
                            account3balanceDAI -= amount;
                            account3invested += amountExpectedViaShares;
                            account3shares += sharesToAdd;
                        }
                        poolBalance += amountExpected;
                        poolTotalAssets += amountExpected;  // there is a small discrepancy due to rounding error (but we still transfer whole amount to pool)
                        poolTotalShares += sharesToAdd;                        
                        break;
                    case 6:
                    case 7:
                    case 8:
                        // withdraw invested from pool
                        const accw = action % 3;
                        const amountCapW = (accw === 0 ? account1invested : (accw === 1 ? account2invested : account3invested));
                        if (amountCapW < 10) {
                            // account has no funds invested, cannot withdraw
                            // TODO: catch a revert here
                            console.log(pad + pad + t + ': Account ' + accw + ' has not enough balance (<10USDC) to withdraw, skipping');
                            break;
                        }
                        var amount = Math.floor(Math.random() * (amountCapW - 10)) + 10;
                        console.log(pad + pad + t + ': Account ' + accw + ' withdraws ' + (amount/1000000.0) + ' USDC from HolyPool');


                        // process withdraw based on reserve present


                        var pricePerShare = vaultBalance / vaultTotalShares;
                        var sharesToWithdraw = 0; //Math.floor(amountToReclaim / pricePerShare);
                        var amountReclaimExpected = 0; // = Math.floor(pricePerShare * sharesToWithdraw);


                        var amountExpected = 0;
                        var reserveLeft = 0;
                        var amountToReclaim = 0;
                        var safeReclaimAmount = Math.floor(vaultBalance * 0.15) - 1000; /* lpPrecision */
                        if (amount <= poolBalance) {
                            // special case, to save gas for customer, we don't reclaim any funds if
                            // current reserve is sufficient
                            console.log(pad + pad + pad + "POOL WITHDRAW FROM RESERVE (no reclaim), poolBalance=" + poolBalance);
                            amountToReclaim = 0;
                            amountExpected = amount;
                            reserveLeft = 1;
                        } else if (amount <= poolBalance + safeReclaimAmount) {
                            // safe withdraw, no fees applied
                            amountToReclaim = amount + poolReserveTarget - poolBalance;
                            if (amountToReclaim <= 0) {
                                console.log(pad + pad + pad + "POOL WOULD HAVE > FULL RESERVE AFTER WITHDRAW, poolBalance=" + poolBalance);
                                amountToReclaim = 0;
                            }                            

                            if (amountToReclaim > safeReclaimAmount) {
                                amountToReclaim = safeReclaimAmount;
                                console.log(pad + pad + pad + "RECLAIM AMOUNT LIMITED TO SAFE AMOUNT, reclaimAmount=" + amountToReclaim);
                            }

                            sharesToWithdraw = Math.floor(amountToReclaim / pricePerShare);
                            amountReclaimExpected = Math.floor(pricePerShare * sharesToWithdraw);

                            amountExpected = amount;
                            reserveLeft = 2;
                        } else {
                            // fees applied, reserves not restored, 0.5% fee for exceeding 0.15 safe amount of vault mock
                            // vault can have some more balance (initial for mock)
                            console.log(pad + pad + pad + "WITHDRAW WITH FEES OCCURED, poolBalance=" + poolBalance + ", safeAmount=" + safeReclaimAmount);
                            reserveLeft = 0;
                            amountToReclaim = amount - poolBalance;

                            sharesToWithdraw = Math.floor(amountToReclaim / pricePerShare);
                            amountReclaimExpected = Math.floor(pricePerShare * sharesToWithdraw);


                            amountExpected = poolBalance;
                            var portionWithoutFees = Math.floor(vaultBalance * 0.15);
                            var portionWithFees = Math.floor((amountReclaimExpected - Math.floor(vaultBalance * 0.15)) * 0.995);
                            console.log(pad + pad + pad + pad + "valor balance: " + vaultBalance + " amount to reclaim: " + amountToReclaim + " portion without fees: " + portionWithoutFees + " portion with fees: " + portionWithFees)
                            //amountExpected += valorBalance + ((amount - poolBalance) * 0.15) + (amount - poolBalance) * 0.85 * 0.995;
                            amountExpected = amountExpected + portionWithoutFees + portionWithFees;
                        }

                        console.log(pad + pad + pad + 'USDC amount to reclaim: ' + amountToReclaim + " amount rounded to LP shares: " + amountReclaimExpected);

                        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN(amount), { from: accounts[accw+1] });
                        

                        // pool shares are burned for full amount (independent of fees)
                        var poolSharesToWithdraw = Math.floor(amount / poolPricePerShare);
                        var amountToDeduct = Math.floor(poolSharesToWithdraw * poolPricePerShare);
                        
                        switch(reserveLeft) {
                            case 0:
                                poolBalance = 0;
                                break;
                            case 1:
                                poolBalance = poolBalance - amount;
                                //amountToDeduct = amount; // withdraw directly from HolyPool reserves
                                break;
                            case 2:
                                poolBalance = poolBalance + amountReclaimExpected - amountExpected;
                                break;
                        }
                        

                        // NOTE: difference in amoutToDeduct / amount is rounding error on the vault side

                        poolTotalAssets -= amount;
                        poolTotalShares -= poolSharesToWithdraw;

                        if (accw === 0) {
                            account1balanceUSDC += Math.floor(amountExpected);
                            account1invested -= amountToDeduct;
                            account1shares -= poolSharesToWithdraw;
                        } else if (accw === 1) {
                            account2balanceUSDC += Math.floor(amountExpected);
                            account2invested -= amountToDeduct;
                            account2shares -= poolSharesToWithdraw;
                        } else {
                            account3balanceUSDC += Math.floor(amountExpected);
                            account3invested -= amountToDeduct;
                            account3shares -= poolSharesToWithdraw;
                        }

                        valorBalance -= amountToReclaim; // valor balance decreased what was requested to withdraw. regardless of rounding/fees
                        valorShares -= sharesToWithdraw;

                        var pricePerShare = vaultBalance / vaultTotalShares;
                        vaultBalance -= amountReclaimExpected;
                        vaultTotalShares = vaultTotalShares - sharesToWithdraw;
                        break;
                    case 9:
                        // HolyValor performs invest of funds into vault
                        var amountCapV = poolBalance - poolReserveTarget;
                        if (amountCapV < 0) {
                            amountCapV = 0; // if pool balance less than reserve, no funds to invest
                        }

                        if (amountCapV <= 10) {
                            // account has no funds invested, cannot withdraw
                            // TODO: catch a revert here
                            console.log(pad + pad + t + ': HolyPool has not enough free funds (<0.00001 USDC above reserve) to invest, skipping');
                            break;
                        }

                        var amount = Math.floor(Math.random() * (amountCapV - 10)) + 10;
                        amount = amountCapV - 10; // invest as much as possible
                        console.log(pad + pad + t + ': HolyValor invests ' + (amount/1000000.0) + ' USDC from HolyPool into Vault');

                        await this.holyvalor.investInVault(web3.utils.toBN(amount), web3.utils.toBN(amount), { from: accounts[0] });
                        poolBalance = poolBalance - amount;
                        valorBalance = valorBalance + amount;

                        var pricePerShare = vaultBalance / vaultTotalShares;
                        vaultBalance = vaultBalance + amount;
                        vaultTotalShares = vaultTotalShares + Math.floor(amount / pricePerShare);
                        valorShares = valorShares + Math.floor(amount / pricePerShare);
                        break;
                    case 10:
                        // HolyValor returns portion of invested body into HolyPool
                        var safeReclaimAmount = (await this.holyvalor.safeReclaimAmount()).toNumber();
                        var amount = Math.floor(Math.random() * safeReclaimAmount);
                        // no matter what safe reclaim amount is, Valor should have own funds in Vault
                        if (amount > valorBalance) {
                            amount = valorBalance;
                        }
                        if (amount === 0) {
                            console.log(pad + pad + t + ': HolyValor does not have funds invested, nothing to return into HolyPool, skipping');
                            break;
                        }
                        console.log(pad + pad + t + ': HolyValor divests ' + (amount/1000000.0) + ' USDC from Vault into HolyPool');






                        // TODO: two multiplications when calculating, mb not the best solution
                        // getPricePerFullShare() .mul(_amount).mul(1e18).div(getPricePerFullShare()).div(1e18);
                        // vaultBalance.mul(1e18).div(totalShares).mul(_amount).mul(1e18).div(vaultBalance).mul(1e18).div(totalShares).div(1e18);


                        var pricePerShare = vaultBalance / vaultTotalShares;
                        var sharesToWithdraw = Math.floor(amount / pricePerShare);
                        var amountExpected = Math.floor(pricePerShare * sharesToWithdraw);

                        // lp to withdraw: amount.mul(1e18).div(getPricePerFullShare())
                        // withdraw lp _shares USDC: getPricePerFullShare().mul(_shares).div(1e18);
                        // getPricePerFullShare = balance.mul(1e18).div(totalShares)
                        var lpSharesReal = web3.utils.toBN(amount);
                        lpSharesReal = lpSharesReal.mul(web3.utils.toBN('1000000000000000000'));
                        var pricePerShareReal = await this.mockvault.getPricePerFullShare();
                        var lpSharesReal = lpSharesReal.div(pricePerShareReal);
                        var usdcReal = pricePerShareReal.mul(lpSharesReal).div(web3.utils.toBN('1000000000000000000'));

                        var valorBalanceReal = await this.holyvalor.amountInvested();
                        var vaultBalanceReal = await this.mockvault.balance();
                        var vaultTotalSharesReal = await this.mockvault.totalShares();
                        console.log(pad + pad + pad + "valor balance real: " + valorBalanceReal.toString() + " calculated: " + valorBalance);
                        console.log(pad + pad + pad + "vault balance real: " + vaultBalanceReal.toString() + " calculated: " + vaultBalance);
                        console.log(pad + pad + pad + "vault total shares real: " + vaultTotalSharesReal.toString() + " calculated: " + vaultTotalShares);

                        console.log(pad + pad + pad + "price per share real: " + pricePerShareReal.toString() + " calculated: " + pricePerShare);
                        console.log(pad + pad + pad + "LP shares real: " + lpSharesReal.toString() + " calculated: " + sharesToWithdraw);
                        
                        console.log(pad + pad + pad + 'USDC amount to divest: ' + amount + " amount rounded to LP shares: " + amountExpected + ", amount real: " + usdcReal.toString());
                        

                        await this.holyvalor.divestFromVault(web3.utils.toBN(amount), true, { from: accounts[0] });
                        

                        vaultBalance = vaultBalance - amountExpected;
                        vaultTotalShares = vaultTotalShares - sharesToWithdraw;

                        poolBalance = poolBalance + amountExpected;
                        valorBalance = valorBalance - amount; // valor balance decreased what was requested to withdraw. regardless of rounding/fees
                        valorShares = valorShares - sharesToWithdraw;
                        break;
                    case 11:
                        // Vault receives yield, HolyValor harvests it and HolyRedeemer distributes it
                        // from 0 tp 0.5% on vault balance, on average (event 1/12 probability due to js rand distribution) 12 * 6 hrs = 72 hrs (half a week)
                        var amount = Math.floor(Math.random() * vaultBalance * 0.005) + 10;
                        console.log(pad + pad + t + ': Vault generates yield of ' + (amount/1000000.0) + ' USDC');

                        totalVaultEarnings += amount;
                        await this.mockvault.earnProfit(web3.utils.toBN(amount), { from: accounts[0] });

                        if (valorBalance < 1000000) {
                            console.log(pad + pad + pad + 'HolyValor has no funds invested (<1 USDC) skipping harvest');

                            vaultBalance += amount;
                            break;
                        }

                        vaultBalance += amount;

                        // until this, holyvalor USDC balance increases, but no other metrics affected until distributed

                        var pricePerShare = vaultBalance / vaultTotalShares;
                        var amountToHarvest = Math.floor(valorShares * pricePerShare) - valorBalance;
                        var sharesToWithdraw = Math.floor(amountToHarvest / pricePerShare);
                        var amountExpected = Math.floor(pricePerShare * sharesToWithdraw);

                        // should gather all yield available (even if very tiny, we don't care about gas costs in test)
                        // harvesting yield decreases lp share amount on holyvalor (and vault too)
                        await this.holyvalor.harvestYield(web3.utils.toBN(Math.floor(amount/2)), web3.utils.toBN(Math.floor(amount*2)));

                        vaultTotalShares -= sharesToWithdraw;
                        vaultBalance -= amountExpected;

                        valorShares -= sharesToWithdraw;
                        // valorBalance is assumed to stay the same (except rounding errors), but yield to distribute increases
                        valorContractBalance += amountExpected;

                        break;
                    case 12:
                        // distribute yield with HolyRedeemer
                        console.log(pad + pad + t + ': HolyRedeemer distributes yield available ' + (valorContractBalance/1000000.0) + ' USDC');

                        await this.holyredeemer.redeemSingleAddress(this.holyvalor.address, { from: accounts[0] });

                        var treasuryIncrease = Math.floor(valorContractBalance * 0.025);
                        var operationsIncrease = Math.floor(valorContractBalance * 0.075);
                        treasuryBalance += treasuryIncrease;
                        operationsBalance += operationsIncrease;
                        poolBalance += valorContractBalance - treasuryIncrease - operationsIncrease;
                        poolTotalAssets += valorContractBalance - treasuryIncrease - operationsIncrease;
                        poolPricePerShare = (1.0 * poolTotalAssets) / poolTotalShares;
                        valorContractBalance = 0; // should distribute all available yield

                        // NOTE: this is not calculated in contract but returned as view function
                        account1invested = Math.floor(poolPricePerShare * account1shares);
                        account2invested = Math.floor(poolPricePerShare * account2shares);
                        account3invested = Math.floor(poolPricePerShare * account3shares);

                        console.log(pad + pad + pad + 'Pool price per share: ' + poolPricePerShare + ', total shares: ' + poolTotalShares);
                        break;
                }

                account1invested = Math.floor(poolPricePerShare * account1shares);
                account2invested = Math.floor(poolPricePerShare * account2shares);
                account3invested = Math.floor(poolPricePerShare * account3shares);

                time.increase(6 * 3600);

                // check metrics
                expect((await this.holyvalor.amountInvested()).toString()).to.equal(web3.utils.toBN(valorBalance).toString());
                expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal(web3.utils.toBN(valorContractBalance).toString());
                expect((await this.holypool.totalAssetAmount()).toString()).to.equal(web3.utils.toBN(poolTotalAssets).toString());
                
                // JS rounding tolerance, error accumulates e.g. during simple deposits without conversion when increasing pool share number
                // TODO: remake this for using BigNumbers
                var realPoolTotalShares = (await this.holypool.totalShareAmount()).toNumber();
                var realAccount1Shares = (await this.holypool.shares(accounts[1])).toNumber();
                var realAccount2Shares = (await this.holypool.shares(accounts[2])).toNumber();
                var realAccount3Shares = (await this.holypool.shares(accounts[3])).toNumber();
                expect(Math.abs(realPoolTotalShares - poolTotalShares)).to.lessThan(1000);
                expect(Math.abs(realAccount1Shares - account1shares)).to.lessThan(1000);
                expect(Math.abs(realAccount2Shares - account2shares)).to.lessThan(1000);
                expect(Math.abs(realAccount3Shares - account3shares)).to.lessThan(1000);
                //expect((await this.holypool.totalShareAmount()).toString()).to.equal(web3.utils.toBN(poolTotalShares).toString());
                //expect((await this.holypool.shares(accounts[1])).toString()).to.equal(web3.utils.toBN(account1shares).toString());
                //expect((await this.holypool.shares(accounts[2])).toString()).to.equal(web3.utils.toBN(account2shares).toString());
                //expect((await this.holypool.shares(accounts[3])).toString()).to.equal(web3.utils.toBN(account3shares).toString());


                expect((await this.mockvault.totalShares()).toString()).to.equal(web3.utils.toBN(vaultTotalShares).toString());
                expect((await this.mockvault.balance()).toString()).to.equal(web3.utils.toBN(vaultBalance).toString());
                expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal(web3.utils.toBN(poolBalance).toString());
                expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal(web3.utils.toBN(account1balanceUSDC).toString());
                expect((await this.mockusdc.balanceOf(accounts[2])).toString()).to.equal(web3.utils.toBN(account2balanceUSDC).toString());
                expect((await this.mockusdc.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN(account3balanceUSDC).toString());
                expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal(web3.utils.toBN(treasuryBalance).toString());
                expect((await this.mockusdc.balanceOf(accounts[6])).toString()).to.equal(web3.utils.toBN(operationsBalance).toString());



                // accept these values (as they are calculated with tiny rounding tolerance)
                var realAccount1Invested = (await this.holypool.getDepositBalance(accounts[1])).toNumber();
                var realAccount2Invested = (await this.holypool.getDepositBalance(accounts[2])).toNumber();
                var realAccount3Invested = (await this.holypool.getDepositBalance(accounts[3])).toNumber();
                expect(Math.abs(realAccount1Invested - account1invested)).to.lessThan(100);
                expect(Math.abs(realAccount2Invested - account2invested)).to.lessThan(100);
                expect(Math.abs(realAccount3Invested - account3invested)).to.lessThan(100);
                //expect((await this.holypool.getDepositBalance(accounts[3])).toString()).to.equal(web3.utils.toBN(account3invested).toString());
            }
            console.log(pad + pad + 'STEP ' + i + ' FINISHED');

            var dailyAPY = (await this.holypool.getDailyAPY()).div(web3.utils.toBN('1000000000000000')).toNumber()/1000.0;
            var inceptionTSPool = (await this.holypool.inceptionTimestamp()).toNumber();
            var daysPassed = ((await time.latest()).toNumber() - inceptionTSPool) / 86400.0;
            console.log(pad + pad + 'account 1: start balance USDC=' + account1startUSDC + ',DAI=' + account1startDAI + ', current balance USDC=' + account1balanceUSDC + ',DAI=' + account1balanceDAI + ", deposit USDC=" + account1invested);
            console.log(pad + pad + 'account 2: start balance USDC=' + account2startUSDC + ',DAI=' + account2startDAI + ', current balance USDC=' + account2balanceUSDC + ',DAI=' + account2balanceDAI + ", deposit USDC=" + account2invested);
            console.log(pad + pad + 'account 3: start balance USDC=' + account3startUSDC + ',DAI=' + account3startDAI + ', current balance USDC=' + account3balanceUSDC + ',DAI=' + account3balanceDAI + ", deposit USDC=" + account3invested);
            console.log(pad + pad + 'total vault earnings=' + totalVaultEarnings + ', treasuryBalance=' + treasuryBalance + ', operationsBalance=' + operationsBalance);
            console.log(pad + pad + 'daily percentage yield=' + dailyAPY + ', days since inception=' + daysPassed);
            console.log(pad + pad + 'current pool share price=' + poolPricePerShare);
        }
    });
});