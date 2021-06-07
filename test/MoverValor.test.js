// test/MoverValor.test.js

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
const MoverValor = artifacts.require('MoverValorYearnUSDCv2VaultV2');
const HolyRedeemer = artifacts.require('HolyRedeemer');

const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const MockVaultUSDC = artifacts.require('InvestmentVaultYUSDCMock');
const MockVaultUSDCv2 = artifacts.require('InvestmentVaultYUSDCv2Mock');
const MockTokenSwapExecutorMock = artifacts.require('TokenSwapExecutorMock');


contract('MoverValor/HolyRedeemer (investment flow scenarios as 2nd valor)', function (accounts) {
    beforeEach(async function () {
        // account 0 is deployer address

        // deploy tokens, exchange and vault mock contracts
        this.mockexecutor = await MockTokenSwapExecutorMock.new({ from: accounts[0] });
        this.mockdai = await MockDAI.new(accounts[0], { from: accounts[0] });
        this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
        this.mockvault = await MockVaultUSDC.new(this.mockusdc.address, { from: accounts[0] });
        this.mockvaultv2 = await MockVaultUSDCv2.new(this.mockusdc.address, { from: accounts[0] });
        await this.mockusdc.approve.sendTransaction(this.mockvault.address, web3.utils.toBN('1000000000000000000'), { from: accounts[9] });
        await this.mockusdc.transfer(accounts[9], web3.utils.toBN('250000000000'), { from: accounts[0] });
        await this.mockvault.setStash(accounts[9]);
        await this.mockusdc.approve.sendTransaction(this.mockvaultv2.address, web3.utils.toBN('1000000000000000000'), { from: accounts[8] });
        await this.mockusdc.transfer(accounts[8], web3.utils.toBN('250000000000'), { from: accounts[0] });
        await this.mockvaultv2.setStash(accounts[8]);

        // deploy HolyHand transfer proxy
        this.holyhand = await deployProxy(HolyHand, { unsafeAllowCustomTypes: true, from: accounts[0] });

        // deploy HolyWing exchange middleware
        this.holywing = await deployProxy(HolyWing, { unsafeAllowCustomTypes: true, from: accounts[0] });
        await this.holyhand.setExchangeProxy.sendTransaction(this.holywing.address, { from: accounts[0] });

        // deploy HolyPool and connect to transfer proxy HolyHand
        this.holypool = await deployProxy(HolyPool, [ this.mockusdc.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
        await this.holypool.setTransferProxy.sendTransaction(this.holyhand.address, { from: accounts[0] });
        await this.holypool.setReserveTarget.sendTransaction(web3.utils.toBN('15000000'), { from: accounts[0] }); // USDC has 6 decimals

        // deploy HolyValor and connect it to HolyPool (as 1st attached valor)
        this.holyvalor = await deployProxy(HolyValor, [ this.mockusdc.address, this.mockvault.address, this.holypool.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
        await this.holyvalor.setPool.sendTransaction(this.holypool.address, { from: accounts[0] });
        await this.holypool.addHolyValor.sendTransaction(this.holyvalor.address, { from: accounts[0] });

        // deploy MoverValor and connect it to HolyPool
        this.movervalor = await deployProxy(MoverValor, [ this.mockusdc.address, this.mockvaultv2.address, this.holypool.address ], { unsafeAllowCustomTypes: true, from: accounts[0] });
        await this.movervalor.setPool.sendTransaction(this.holypool.address, { from: accounts[0] });
        await this.holypool.addHolyValor.sendTransaction(this.movervalor.address, { from: accounts[0] });

        // deploy HolyRedeemer and connect to MoverValor
        this.holyredeemer = await deployProxy(HolyRedeemer, [], { unsafeAllowCustomTypes: true, from: accounts[0] });
        await this.holyvalor.setYieldDistributor.sendTransaction(this.holyredeemer.address, { from: accounts[0] });
        await this.movervalor.setYieldDistributor.sendTransaction(this.holyredeemer.address, { from: accounts[0] });
        await this.holyredeemer.setPoolAddress.sendTransaction(this.holypool.address, { from: accounts[0] });
        await this.holyredeemer.setTreasuryAddress.sendTransaction(accounts[5], { from: accounts[0] });
        await this.holyredeemer.setOperationsAddress.sendTransaction(accounts[6], { from: accounts[0] });
        await this.holyredeemer.setTreasuryPercentage.sendTransaction(web3.utils.toBN('2500000000000000000'), { from: accounts[0] });
        await this.holyredeemer.setOperationsPercentage.sendTransaction(web3.utils.toBN('7500000000000000000'), { from: accounts[0] });

        // Advance to the next block to correctly read time in the solidity "now" function interpreted by ganache
        await time.advanceBlock();
    });

    // test invest/divest and withdraw when all funds are divested and on HolyPool balance
    it('MoverValor should be able to borrow funds to invest and return them back', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to another account
        await this.mockusdc.transfer(accounts[2], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        // perform deposit without tokens exchange
        await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('200000000'), web3.utils.toBN('0'), [], { from: accounts[1] }), "transfer amount exceeds balance");
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to MoverValor
        // if pool won't return minimum amount requested, should revert
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('150000000'), { from: accounts[0] }), "minimum amount not available");
        // 85 USDC should be available to borrow for investing
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('85000000'), { from: accounts[0] });
        // now pool has no funds (except reserve amount)
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('1000000'), web3.utils.toBN('1000'), { from: accounts[0] }), "not enough funds");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // place funds back to pool, should be exactly same amount (with safe execution -- vault mock should have balance available)
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('900000000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        // vault should not have this much funds to reclaim
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('86000000'), false, { from: accounts[0] }), "insufficient lp tokens");
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('12960000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        await this.movervalor.divestFromVault(web3.utils.toBN('12750000'), true, { from: accounts[0] });

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // account cannot withdraw more than he has deposited in pool
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('21000000'), { from: accounts[1] });

        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('21000000');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('79000000');

        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        truffleAssert.eventNotEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return true;
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "21000000" && ev.amountActual.toString() === "21000000";
        });
    });

    // test withdraw without reclaiming from HolyPool reserve while funds portion is invested
    it('MoverValor invest funds and customer withdraw portion from HolyPool reserve', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to another account
        await this.mockusdc.transfer(accounts[2], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        // perform deposit without tokens exchange
        await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('200000000'), web3.utils.toBN('0'), [], { from: accounts[1] }), "transfer amount exceeds balance");
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to MoverValor
        // if pool won't return minimum amount requested, should revert
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('150000000'), { from: accounts[0] }), "minimum amount not available");
        // 85 USDC should be available to borrow for investing
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('85000000'), { from: accounts[0] });
        // now pool has no funds (except reserve amount)
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('1000000'), web3.utils.toBN('1000'), { from: accounts[0] }), "not enough funds");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // place funds back to pool, should be exactly same amount (with safe execution -- vault mock should have balance available)
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('900000000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        // vault should not have this much funds to reclaim
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('86000000'), false, { from: accounts[0] }), "insufficient lp tokens");
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('12960000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // account cannot withdraw more than he has deposited in pool
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('7500000'), { from: accounts[1] });

        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('7500000');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('92500000');

        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        truffleAssert.eventNotEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return true;
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "7500000" && ev.amountActual.toString() === "7500000";
        });
    });

    // test invest/divest with reclaiming (safe amount) with partial reserve refill
    it('MoverValor invest/divest, HolyPool reclaims funds for customer to withdraw (safe amount, partial reserve refill)', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to another account
        await this.mockusdc.transfer(accounts[2], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        // perform deposit without tokens exchange
        await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('200000000'), web3.utils.toBN('0'), [], { from: accounts[1] }), "transfer amount exceeds balance");
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to MoverValor
        // if pool won't return minimum amount requested, should revert
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('150000000'), { from: accounts[0] }), "minimum amount not available");
        // 85 USDC should be available to borrow for investing
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('85000000'), { from: accounts[0] });
        // now pool has no funds (except reserve amount)
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('1000000'), web3.utils.toBN('1000'), { from: accounts[0] }), "not enough funds");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // place funds back to pool, should be exactly same amount (with safe execution -- vault mock should have balance available)
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('900000000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        // vault should not have this much funds to reclaim
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('86000000'), false, { from: accounts[0] }), "insufficient lp tokens");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // account cannot withdraw more than he has deposited in pool
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('25000000'), { from: accounts[1] });

        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('25000000');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('75000000');

        // amount of 85 (invested) * 15% safe amount = 12.9 - 0.001 lpPrecision = 12.899 = 12899000
        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        truffleAssert.eventEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return ev.investProxy.toString() === this.movervalor.address.toString() && ev.amountRequested.toString() === "10000000" && ev.amountReclaimed.toString() === "12899000";
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "25000000" && ev.amountActual.toString() === "25000000";
        });

        // check that pool has portion of reserves replenished
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('2899000');
    });

    // test invest/divest with reclaiming (safe amount) with full reserve refill
    it('MoverValor invest/divest, HolyPool reclaims funds for customer to withdraw (safe amount, full reserve refill)', async function() {
        // set reserve to 3.5 USDC
        await this.holypool.setReserveTarget.sendTransaction(web3.utils.toBN('3500000'), { from: accounts[0] }); // USDC has 6 decimals

        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to another account
        await this.mockusdc.transfer(accounts[2], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        // perform deposit without tokens exchange
        await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('200000000'), web3.utils.toBN('0'), [], { from: accounts[1] }), "transfer amount exceeds balance");
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to MoverValor
        // if pool won't return minimum amount requested, should revert
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('150000000'), { from: accounts[0] }), "minimum amount not available");
        // 97.5 USDC should be available to borrow for investing (valor borrows 95)
        await this.movervalor.investInVault(web3.utils.toBN('95000000'), web3.utils.toBN('95000000'), { from: accounts[0] });
        // now pool has only 1.5 USDC left that is allowed to invest
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('29000000'), web3.utils.toBN('9000000'), { from: accounts[0] }), "minimum amount not available");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // place funds back to pool, should be exactly same amount (with safe execution -- vault mock should have balance available)
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('75000000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        // vault should not have this much funds to reclaim
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('98000000'), false, { from: accounts[0] }), "insufficient lp tokens");

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // account cannot withdraw more than he has deposited in pool
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");

        // we have safe withdraw reserve of 5 USDC on HolyPool + (95 +1 initial USDC)*0.15-0.001=14.399000 on MoverValor
        expect((await this.movervalor.totalReclaimAmount()).toString()).to.equal('95000000');
        expect((await this.movervalor.safeReclaimAmount()).toString()).to.equal('14399000');

        // if we request withdraw of 15, actual 15 should be withdrawn and 3.75 reserve should be present on HolyPool
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('15000000'), { from: accounts[1] });

        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('15000000');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('85000000');

        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        truffleAssert.eventEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return ev.investProxy.toString() === this.movervalor.address.toString() && ev.amountRequested.toString() === "10000000" && ev.amountReclaimed.toString() === "13500000";
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "15000000" && ev.amountActual.toString() === "15000000";
        });

        // check that pool has portion of reserves replenished
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('3500000');
    });

  // test invest/divest with reclaiming (fee applied)
  it('MoverValor invest (no divest), HolyPool reclaims funds for customer to withdraw (fee applied)', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');
    
        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to another account
        await this.mockusdc.transfer(accounts[2], await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });
    
        // perform deposit without tokens exchange
        await truffleAssert.reverts(this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('200000000'), web3.utils.toBN('0'), [], { from: accounts[1] }), "transfer amount exceeds balance");
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });
    
        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');
    
        // perform investment borrowing to MoverValor
        // if pool won't return minimum amount requested, should revert
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('150000000'), { from: accounts[0] }), "minimum amount not available");
        // 85 USDC should be available to borrow for investing
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('85000000'), { from: accounts[0] });
        // now pool has no funds (except reserve amount)
        await truffleAssert.reverts(this.movervalor.investInVault(web3.utils.toBN('1000000'), web3.utils.toBN('1000'), { from: accounts[0] }), "not enough funds");
    
        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');
    
        // place funds back to pool, should be exactly same amount (with safe execution -- vault mock should have balance available)
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('900000000'), true, { from: accounts[0] }), "insufficient safe withdraw balance");
        // vault should not have this much funds to reclaim
        await truffleAssert.reverts(this.movervalor.divestFromVault(web3.utils.toBN('86000000'), false, { from: accounts[0] }), "insufficient lp tokens");
    
        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');
    
        expect((await this.movervalor.safeReclaimAmount()).toString()).to.equal('12899000');

        // account cannot withdraw more than he has deposited in pool
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('45000000'), { from: accounts[1] });
    
        // 15 USDC on contract + 12.9 safe amount on valor + 17.1 * 0.995 (17.0145) = 44.9145 (44914500)
        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('44914500');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('55000000');
    
        // amount of 85 (invested) * 15% safe amount = 12.9 - 0.001 lpPrecision = 12.899 = 12899000
        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        truffleAssert.eventEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return ev.investProxy.toString() === this.movervalor.address.toString() && ev.amountRequested.toString() === "30000000" && ev.amountReclaimed.toString() === "29914500";
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "45000000" && ev.amountActual.toString() === "44914500";
        });
    
        // check that pool has reserves depleted
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('0');
    });

    // test invest/divest with reclaiming (fee applied)
    it('MoverValor invest, Vault earns some yield, and it is distributed by HolyRedeemer', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 100 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('100000000'), { from: accounts[0]} );
        // transfer the rest of USDC to vault mock to have additional balance
        await this.mockusdc.transfer(this.mockvaultv2.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        // perform deposit without tokens exchange
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to MoverValor (85 USDC should be available to borrow for investing)
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('5000000'), { from: accounts[0] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('0');

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // MoverValor should have 85 lp tokens 1-to-1 price to USDC as no yield realized
        expect((await this.mockvaultv2.balanceOf(this.movervalor.address)).toString()).to.equal('85000000');
        expect((await this.mockvaultv2.pricePerShare()).toString()).to.equal('1000000');

        // earn 5 USDC (on 85 USDC invested)
        await this.mockvaultv2.earnProfit.sendTransaction(web3.utils.toBN('5000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('0');

        // MoverValor should have 85 lp tokens but with higher price as vault has got yield
        expect((await this.mockvaultv2.balanceOf(this.movervalor.address)).toString()).to.equal('85000000');
        expect((await this.mockvaultv2.pricePerShare()).toString()).to.equal('1058139'); // 91/86 = 10581395348837209302325581..
        expect((await this.movervalor.lpTokensBalance()).toString()).to.equal('85000000');
        expect((await this.movervalor.amountInvested()).toString()).to.equal('85000000');

        // MoverValor realized yield to it's own balance
        await truffleAssert.reverts(this.movervalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[1] }), "Finmgmt only");
        const txHarvest = await this.movervalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[0] });

        // now MoverValor should have 5 USDC on its address
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        // earned rom 85/86 of 5 USDC = 4,941860(46511627f9069767441..)
        // 1058139534883720930 price per full share
        // accruedYieldUSDC = 85000000 * 1058139534883720930 / 1000000000000000000 - 85000000;
        //                    = 89 941 860 (,46511627905) - 85 000 000 = 4 941 860 (,46511627905)
        // lpTokensToWithdraw = accruedYieldUSDC * 1000000000000000000 / 1058139534883720930;
        //                    = 4 941 860 * 1e18 / 1058139534883720930 = 4 670 329 (,2307692307702572152155537)
        // so the result would be 4,941859 USDC because of rounding error
        // lpTokenBalance should be 85000000 - 4670329 = 80329671
        // we not received 0.000001 USDC due to rounding truncation, but that's ok
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('4941814');
        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');
        expect((await this.holypool.baseAssetPerShare()).toString()).to.equal('1000000000000000000');

        truffleAssert.eventEmitted(txHarvest, 'HarvestYield', (ev) => {
            return ev.lpWithdrawn.toString() === "4670289" && ev.baseAssetExpected.toString() === "4941815"
                            && ev.baseAssetReceived.toString() === "4941814" && ev.lpTokensBalance.toString() == "80329711";
        });

        await this.holyredeemer.redeemSingleAddress(this.movervalor.address, { from: accounts[0] });
        // check that treasury got 2.5% of the profits
        expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('123545'); // 4941814 * 0.025
        // check that operations got 7.5% of the profits
        expect((await this.mockusdc.balanceOf(accounts[6])).toString()).to.equal('370636'); // 4941814 * 0.075
        // check that pool got 90% of the profits
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('19447633'); // 4941814 - 123546 - 370639 + reserve 15000000

        // pool share USDC value should also go up
        expect((await this.holypool.baseAssetPerShare()).toString()).to.equal('1044035970297029702'); // 4447674 100/101 = 4403637 (,62376237623762376237)
        // actually single user deposited into pool, to it's his profits
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('104403597');
    });

    it('HolyValor invest, MoverValor invest, Vault earns some yield, and it is distributed by HolyRedeemer, amount is withdrawn from both Valors', async function() {
        // accounts[1] would perform investment, send him USDC
        await this.mockusdc.approve.sendTransaction(this.holyhand.address, web3.utils.toBN('1000000000000000000000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('500000000000');

        // transfer 200 USDC to accounts[1]
        await this.mockusdc.transfer(accounts[1], web3.utils.toBN('200000000'), { from: accounts[0]} );
        // transfer the rest of USDC to vault mock to have additional balance
        await this.mockusdc.transfer(this.mockvault.address, web3.utils.toBN('10000000000'), { from: accounts[0] });
        await this.mockusdc.transfer(this.mockvaultv2.address, await this.mockusdc.balanceOf(accounts[0]), { from: accounts[0] });

        //// 1st valor (USDCv1) taking funds
        // perform deposit without tokens exchange
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // perform investment borrowing to HolyValor (85 USDC should be available to borrow for investing)
        await this.holyvalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('5000000'), { from: accounts[0] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('0');

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('100000000');

        // HolyValor should have 85 lp tokens 1-to-1 price to USDC as no yield realized
        expect((await this.mockvault.balanceOf(this.holyvalor.address)).toString()).to.equal('85000000');
        expect((await this.mockvault.getPricePerFullShare()).toString()).to.equal('1000000000000000000');

        // earn 5 USDC (on 85 USDC invested)
        await this.mockvault.earnProfit.sendTransaction(web3.utils.toBN('5000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('0');

        // HolyValor should have 85 lp tokens but with higher price as vault has got yield
        expect((await this.mockvault.balanceOf(this.holyvalor.address)).toString()).to.equal('85000000');
        expect((await this.mockvault.getPricePerFullShare()).toString()).to.equal('1058139534883720930'); // 91/86 = 10581395348837209302325581..
        expect((await this.holyvalor.lpTokensBalance()).toString()).to.equal('85000000');
        expect((await this.holyvalor.amountInvested()).toString()).to.equal('85000000');

        //// 2nd valor (USDCv2) taking funds
        // perform deposit without tokens exchange
        this.holyhand.depositToPool(this.holypool.address, this.mockusdc.address, web3.utils.toBN('100000000'), web3.utils.toBN('0'), [], { from: accounts[1] });

        // verify that deposited amount is correct and received
        expect((await this.holypool.getDepositBalance(accounts[0])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('200000000');

        // perform investment borrowing to MoverValor (100 USDC should be available to borrow for investing)
        await this.movervalor.investInVault(web3.utils.toBN('200000000'), web3.utils.toBN('5000000'), { from: accounts[0] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('0');

        // deposited balance should stay in place for account
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('200000000');

        // MoverValor should have 85 lp tokens 1-to-1 price to USDC as no yield realized
        expect((await this.mockvaultv2.balanceOf(this.movervalor.address)).toString()).to.equal('100000000');
        expect((await this.mockvaultv2.pricePerShare()).toString()).to.equal('1000000');

        // earn 10 USDC (on 100 USDC invested)
        await this.mockvaultv2.earnProfit.sendTransaction(web3.utils.toBN('10000000'), { from: accounts[1] });
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('0');

        // MoverValor should have 100 lp tokens but with higher price as vault has got yield
        expect((await this.mockvaultv2.balanceOf(this.movervalor.address)).toString()).to.equal('100000000');
        expect((await this.mockvaultv2.pricePerShare()).toString()).to.equal('1099009'); // 111/101 = 1,099009900990099009..
        expect((await this.movervalor.lpTokensBalance()).toString()).to.equal('100000000');
        expect((await this.movervalor.amountInvested()).toString()).to.equal('100000000');




        // HolyValor realized yield to it's own balance
        await truffleAssert.reverts(this.holyvalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[1] }), "Finmgmt only");
        const txHarvest1 = await this.holyvalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[0] });

        // MoverValor realized yield to it's own balance
        await truffleAssert.reverts(this.movervalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[1] }), "Finmgmt only");
        const txHarvest2 = await this.movervalor.harvestYield.sendTransaction(web3.utils.toBN('4000000'), web3.utils.toBN('10000000'), { from: accounts[0] });

        // now HolyValor should have 5 USDC and MoverValor should have 10 USDC on its address
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('15000000');
        // earned rom 85/86 of 5 USDC = 4,941860(46511627f9069767441..)
        // 89.94186/85 = 1058139534883720930 price per full share
        // accruedYieldUSDC = 85000000 * 1058139534883720930 / 1000000000000000000 - 85000000;
        //                    = 89 941 860 (,46511627905) - 85 000 000 = 4 941 860 (,46511627905)
        // lpTokensToWithdraw = accruedYieldUSDC * 1000000000000000000 / 1058139534883720930;
        //                    = 4 941 860 * 1e18 / 1058139534883720930 = 4 670 329 (,2307692307702572152155537)
        // so the result would be 4,941859 USDC because of rounding error
        // lpTokenBalance should be 85000000 - 4670329 = 80329671
        // we not received 0.000001 USDC due to rounding truncation, but that's ok
        expect((await this.mockusdc.balanceOf(this.holyvalor.address)).toString()).to.equal('4941859');
        // earned rom 100/101 of 10 USDC = 9,900990
        // 109.900990/100 = 1099009900000000000 price per full share
        // accruedYieldUSDC = 100000000 * 1099009900000000000 / 1000000000000000000 - 100000000;
        //                    = 9 900 990
        // lpTokensToWithdraw = accruedYieldUSDC * 1000000000000000000 / 1099009900000000000;
        //                    = 9 900 990 * 1e18 / 1099009900000000000 = 9 009 008 (),927035143177)
        // so the result would be 9,009008 USDC because of rounding error
        // lpTokenBalance should be 100000000 - 9900990 = 90099010
        // we not received 0.000001 USDC due to rounding truncation, but that's ok
        expect((await this.mockusdc.balanceOf(this.movervalor.address)).toString()).to.equal('9900899');
        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('0');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('200000000');
        expect((await this.holypool.baseAssetPerShare()).toString()).to.equal('1000000000000000000'); // no profit received yet

        truffleAssert.eventEmitted(txHarvest1, 'HarvestYield', (ev) => {
            return ev.lpWithdrawn.toString() === "4670329" && ev.baseAssetExpected.toString() === "4941860"
                            && ev.baseAssetReceived.toString() === "4941859" && ev.lpTokensBalance.toString() == "80329671";
        });

        truffleAssert.eventEmitted(txHarvest2, 'HarvestYield', (ev) => {
            return ev.lpWithdrawn.toString() === "9008934" && ev.baseAssetExpected.toString() === "9900900"
                            && ev.baseAssetReceived.toString() === "9900899" && ev.lpTokensBalance.toString() == "90991066";
        });

        await this.holyredeemer.redeemSingleAddress(this.holyvalor.address, { from: accounts[0] });
        await this.holyredeemer.redeemSingleAddress(this.movervalor.address, { from: accounts[0] });

        // check that treasury got 2.5% of the profits
        expect((await this.mockusdc.balanceOf(accounts[5])).toString()).to.equal('371068'); // (4941859 + 9900988) * 0.025
        // check that operations got 7.5% of the profits
        expect((await this.mockusdc.balanceOf(accounts[6])).toString()).to.equal('1113206'); // (4941859 + 9900988) * 0.075
        // check that pool got 90% of the profits
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('28358484'); // (4941859 + 9900988) - 371070 - 1113213 + reserve 15000000

        // pool share USDC value should also go up
        expect((await this.holypool.baseAssetPerShare()).toString()).to.equal('1066460119402985074'); // 214.358564/201 = 1,066460517412935323383
        // actually single user deposited into pool, to it's his profits
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('213292023'); // 213.29 USDC

        // withdraw almost everything (205 USDC)
        // that should reclaim funds from both valors
        // and use a portion of reserves
        // fees would incur on both valor reclaims (0.5% each for mocked data)
        await truffleAssert.reverts(this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('80000000000'), { from: accounts[1] }), "amount exceeds balance");
        const txWithdraw = await this.holyhand.withdrawFromPool.sendTransaction(this.holypool.address, web3.utils.toBN('213000000'), { from: accounts[1] });

        //15 USDC in reserves + 13.358564 USD realized yield + (~85USDC + 100USDC) * (0.15 + 0.85 * 0.995) = 184.21375 = 212,572314 (some amount left on one of valors)
        expect((await this.mockusdc.balanceOf(accounts[1])).toString()).to.equal('212217158');
        expect((await this.holypool.getDepositBalance(accounts[1])).toString()).to.equal('292024');

        const innerTxHolyPool = await truffleAssert.createTransactionResult(this.holypool, txWithdraw.tx);
        // MoverValor is fully depleted after withdraw
        truffleAssert.eventEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return ev.investProxy.toString() === this.movervalor.address.toString() && ev.amountRequested.toString() === "100000000" && ev.amountReclaimed.toString() === "99575823";
        });  
        // from HolyValor claim a portion, but leaving tiny amount
        truffleAssert.eventEmitted(innerTxHolyPool, 'ReclaimFunds', (ev) => {
            return ev.investProxy.toString() === this.holyvalor.address.toString() && ev.amountRequested.toString() === "84641516" && ev.amountReclaimed.toString() === "84282851";
        });  
        truffleAssert.eventEmitted(innerTxHolyPool, 'Withdraw', (ev) => {
            return ev.account.toString() === accounts[1].toString() && ev.amountRequested.toString() === "213000000" && ev.amountActual.toString() === "212217158";
        });

        expect((await this.movervalor.amountInvested()).toString()).to.equal('0');
        expect((await this.holyvalor.amountInvested()).toString()).to.equal('358484');

        // reserves were not refilled, because withdrawal occures with fees from both valors
        expect((await this.mockusdc.balanceOf(this.holypool.address)).toString()).to.equal('0');
    });
});




// test if withdraw requires all of available amount

// test if withdraw exceeds all of available amount

// test reserve rebalance (not available)

// test reserve rebalance (partial reserve refill)

// test reserve rebalance (full reserve refill)

// test multiple deposits/harvests/withdrawals/deposits

// test if loss occured (negative yield scenario)

// test realizing profits to HolyPool while withdrawing and then complete withdraw (that no funds are stuck)

// test emergencyWithdraw

// test shutdown (no deposits, safe funds reclaimed and only divest is available)

// test forced shutdown (reclaim all available funds asap) and place back to HolyPool (even with fee)

////////////////////////////////

// test yield with one valor and several users with deposits and withdrawals

// test yield with two valors and several users with deposits and withdrawals

// test multiple holyvalors withdraw

// test holyvalor with restricted deposits

