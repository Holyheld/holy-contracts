// test/InvestmentFlowFuzz.test.js

// Load dependencies
const { expect } = require('chai');
const truffleAssert = require('truffle-assertions');
const { deployProxy } = require('@openzeppelin/truffle-upgrades');
const { time } = require('@openzeppelin/test-helpers');

// Load compiled artifacts
const MockDAI = artifacts.require('ERC20DAIMock');
const MockUSDC = artifacts.require('ERC20USDCMock');
const SmartTreasury = artifacts.require('SmartTreasuryV2');
const MoverToken = artifacts.require('MoverToken');
const HolyHandV3 = artifacts.require('HolyHandV3');

const MockSushi = artifacts.require('SushiTokenMock');
const MockChef = artifacts.require('MasterChefMock');

function float2int(val) {
    return val | 0;
}

contract('SmartTreasury (random tests)', function (accounts) {
    // test multiple deposits, withdraws, harvests
    it('should perform random operations matching with model', async function() {
        this.timeout(1200000); // yes, such test is going to take a while

        // The goal is to check:
        // - if numbers stay in expected range;
        // - if multiple actions processed as expected;
        // scenarios generated:
        // - account 0 is deployer address;
        // - accounts 1,2,3 are investors;
        // events are generated at random:
        // - account is depositing MOVE;
        // - account is depositing MOVE-LP;
        // - account is depositing both MOVE and MOVE-LP;
        // - account is withdrawing MOVE;
        // - account is withdrawing MOVE-LP;
        // - account is withdrawing MOVE and MOVE-LP;
        // - treasury is receiving rewards;
        // - account is performing claim&burn of some MOVE tokens;
        // JS variables are used to track numbers
        // between every action 6 hours inverval is passed
        // The model calculates bonuses for every account when yield is received, in traditional way.
        // This differs from how smart contract work, because it uses
        // more compicated mechanics to keep computational complexity constant.
        // Nonetheless, values of distributed bonus depending on staked propotions should match.

        this.prepareCleanDeployment = async function () {    
            this.mockusdc = await MockUSDC.new(accounts[0], { from: accounts[0] });
            this.mover = await deployProxy(MoverToken, ["Mover", "MOVE"], { unsafeAllowCustomTypes: true, from: accounts[0] });
            // mock of DAI suits us (18 decimals) as simple ERC20 token
            this.movelpmock = await MockDAI.new(accounts[0], { from: accounts[0] });
            this.st = await deployProxy(SmartTreasury, ["Mover Bonus", "MOBO", this.mockusdc.address, this.mover.address, this.movelpmock.address], { unsafeAllowCustomTypes: true, from: accounts[0] });
            this.hh = await deployProxy(HolyHandV3, { unsafeAllowCustomTypes: true, from: accounts[0] });
        
            await this.st.grantRole.sendTransaction(web3.utils.sha3("EXECUTOR_ROLE"), this.hh.address, { from: accounts[0] });
            await this.hh.setSmartTreasury.sendTransaction(this.st.address, { from: accounts[0] });
            await this.hh.setTreasuryTokens.sendTransaction(this.mover.address, this.movelpmock.address, { from: accounts[0] });
            await time.advanceBlock();

            const minter_role = await this.mover.MINTER_ROLE();
            await this.mover.grantRole(minter_role, accounts[0]);
        
            await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[1] });
            await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[2] });
            await this.mover.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[3] });
            await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[1] });
            await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[2] });
            await this.movelpmock.approve.sendTransaction(this.hh.address, web3.utils.toBN('1000000000000000000000'), { from: accounts[3] });

            await this.mockusdc.approve.sendTransaction(this.st.address, web3.utils.toBN('1000000000000'), { from: accounts[0] });


            // deploy mocks of MasterChef contract and sushi contract
            this.mocksushi = await MockSushi.new({ from: accounts[0] });
            this.mockchef = await MockChef.new(this.mocksushi.address, accounts[0], web3.utils.toBN('100000000000000000000'), 0, 0, { from: accounts[0] });
            // allow MasterChef to mint sushi
            await this.mocksushi.transferOwnership(this.mockchef.address, { from: accounts[0] });
            // add onsen pool
            await this.mockchef.add.sendTransaction(web3.utils.toBN('10000'), this.movelpmock.address, true, { from: accounts[0] });

            await this.st.grantRole.sendTransaction(web3.utils.sha3("FINMGMT_ROLE"), accounts[0], { from: accounts[0] });
            await this.st.setSushiAddresses(this.mockchef.address, this.mocksushi.address, 0);

            // set sushi fee to 5%
            await this.st.setSushiFee(web3.utils.toBN('5000000000000000000'), { from: accounts[0] });

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
            var account1balanceMOVE = Math.floor(Math.random() * 99000000) + 1000000;
            var account2balanceMOVE = Math.floor(Math.random() * 99000000) + 1000000;
            var account3balanceMOVE = Math.floor(Math.random() * 99000000) + 1000000;
            var account1balanceMOVELP = Math.floor(Math.random() * 300000) + 10000;
            var account2balanceMOVELP = Math.floor(Math.random() * 300000) + 10000;
            var account3balanceMOVELP = Math.floor(Math.random() * 300000) + 10000;

            var account1startMOVE = account1balanceMOVE;
            var account2startMOVE = account2balanceMOVE;
            var account3startMOVE = account3balanceMOVE;
            var account1startMOVELP = account1balanceMOVELP;
            var account2startMOVELP = account2balanceMOVELP;
            var account3startMOVELP = account3balanceMOVELP;

            var account1stakedMOVE = 0;
            var account2stakedMOVE = 0;
            var account3stakedMOVE = 0;
            var account1stakedMOVELP = 0;
            var account2stakedMOVELP = 0;
            var account3stakedMOVELP = 0;

            // control metrics
            var account1bonusP = 0;
            var account2bonusP = 0;
            var account3bonusP = 0;
            var account1bonusTokens = 0;
            var account2bonusTokens = 0;
            var account3bonusTokens = 0;
            var account1burned = 0;
            var account2burned = 0;
            var account3burned = 0;
            var account1usdc = 0;
            var account2usdc = 0;
            var account3usdc = 0;
            var stakedMOVE = 0;
            var stakedMOVELP = 0;

            var stakedSLPMasterchef = 0;

            var endowmentBalance = 0;
            var bonusBalance = 0;

            var bonusSpent = 0; // for report

            expect((await this.mockusdc.balanceOf(accounts[0])).toString()).to.equal('1000000000000');

            // mint MOVE to accounts
            await this.mover.mint.sendTransaction(accounts[1], web3.utils.toBN(account1balanceMOVE).imuln(1000000).imuln(1000000), { from: accounts[0] });
            await this.mover.mint.sendTransaction(accounts[2], web3.utils.toBN(account2balanceMOVE).imuln(1000000).imuln(1000000), { from: accounts[0] });
            await this.mover.mint.sendTransaction(accounts[3], web3.utils.toBN(account3balanceMOVE).imuln(1000000).imuln(1000000), { from: accounts[0] });

            await this.movelpmock.transfer.sendTransaction(accounts[1], web3.utils.toBN(account1balanceMOVELP).imuln(1000000).imuln(1000000), { from: accounts[0] });
            await this.movelpmock.transfer.sendTransaction(accounts[2], web3.utils.toBN(account2balanceMOVELP).imuln(1000000).imuln(1000000), { from: accounts[0] });
            await this.movelpmock.transfer.sendTransaction(accounts[3], web3.utils.toBN(account3balanceMOVELP).imuln(1000000).imuln(1000000), { from: accounts[0] });

            // roll the dice N times, simulate event and calculate expected amounts on client-side
            for (var t = 0; t < 500; t++) {
                const action = Math.floor(Math.random() * 12);
                // 0-2 account 1,2,3 deposit
                // 3-5 account 1,2,3 withdraw
                // 6-8 account 1,2,3 performs claim&burn
                // 9 st receives rewards
                // 10 st deposits SLP tokens to receive sushi rewards
                // 11 st withdraws SLP tokens

                switch(action) {
                    case 0:
                    case 1:
                    case 2:
                        // deposit MOVE / MOVE-ETH LP
                        var acc = action % 3;
                        var amountCapMove = (acc === 0 ? account1balanceMOVE : (acc === 1 ? account2balanceMOVE : account3balanceMOVE));
                        var amountCapMoveLP = (acc === 0 ? account1balanceMOVELP : (acc === 1 ? account2balanceMOVELP : account3balanceMOVELP));
                        if (amountCapMove < 100) {
                            amountCapMove = 0;
                        }
                        var amountMove = (amountCapMove == 0) ? 0 : (Math.floor(Math.random() * (amountCapMove - 100)) + 100);
                        if (amountCapMoveLP < 100) {
                            amountCapMoveLP = 0;
                        }
                        var amountMoveLP = (amountCapMoveLP == 0) ? 0 : (Math.floor(Math.random() * (amountCapMoveLP - 100)) + 100);
                        // 80% chance that MOVE-LP would be 0
                        if (Math.floor(Math.random() * 10) < 8) {
                            amountMoveLP = 0;
                        }
                        // 50% chance that MOVE is zero if MOVE-LP is not zero
                        if (amountMoveLP > 0 && Math.floor(Math.random() * 10) < 5) {
                            amountMove = 0;
                        }
                        if (amountMove == 0 && amountMoveLP == 0) {
                            console.log(pad + pad + t + ': Account ' + acc + ' has <0.0001 MOVE/MOVE-LP to deposit, skipping');
                            break;
                        }

                        console.log(pad + pad + t + ': Account ' + acc + ' deposits ' + (amountMove/1000000.0) + ' MOVE and ' + (amountMoveLP/1000000.0) + ' MOVE-LP');
                        console.log(pad + pad + pad + 'staked MOVE:' + stakedMOVE + ', staked MOVE-LP:' + stakedMOVELP);

                        await this.hh.depositToTreasury(web3.utils.toBN(amountMove).imuln(1000000).imuln(1000000), web3.utils.toBN(amountMoveLP).imuln(1000000).imuln(1000000), { from: accounts[acc+1] });

                        if (acc === 0) {
                            account1balanceMOVE -= amountMove;
                            account1balanceMOVELP -= amountMoveLP;
                            account1stakedMOVE += amountMove;
                            account1stakedMOVELP += amountMoveLP;
                            account1bonusTokens += account1bonusP; // tokenize bonus
                            account1bonusP = 0;
                        } else if (acc === 1) {
                            account2balanceMOVE -= amountMove;
                            account2balanceMOVELP -= amountMoveLP;
                            account2stakedMOVE += amountMove;
                            account2stakedMOVELP += amountMoveLP;
                            account2bonusTokens += account2bonusP; // tokenize bonus
                            account2bonusP = 0;
                        } else {
                            account3balanceMOVE -= amountMove;
                            account3balanceMOVELP -= amountMoveLP;
                            account3stakedMOVE += amountMove;
                            account3stakedMOVELP += amountMoveLP;
                            account3bonusTokens += account3bonusP; // tokenize bonus
                            account3bonusP = 0;
                        }
                        stakedMOVE += amountMove;
                        stakedMOVELP += amountMoveLP;
                        break;
                    case 3:
                    case 4:
                    case 5:
                        // Claim and burn for portion of MOVE tokens
                        var acc = action % 3;
                        var amountCapMove = (acc === 0 ? account1stakedMOVE : (acc === 1 ? account2stakedMOVE : account3stakedMOVE));
                        var amountCapMoveLP = (acc === 0 ? account1stakedMOVELP : (acc === 1 ? account2stakedMOVELP : account3stakedMOVELP));
                        if (amountCapMove < 100) {
                            amountCapMove = 0;
                        }
                        var amountMove = (amountCapMove == 0) ? 0 : (Math.floor(Math.random() * (amountCapMove - 100)) + 100);
                        if (amountCapMoveLP < 100) {
                            amountCapMoveLP = 0;
                        }
                        var amountMoveLP = (amountCapMoveLP == 0) ? 0 : (Math.floor(Math.random() * (amountCapMoveLP - 100)) + 100);
                        // 80% chance that MOVE-LP would be 0
                        if (Math.floor(Math.random() * 10) < 8) {
                            amountMoveLP = 0;
                        }
                        // 50% chance that MOVE is zero if MOVE-LP is not zero
                        if (amountMoveLP > 0 && Math.floor(Math.random() * 10) < 5) {
                            amountMove = 0;
                        }
                        if (amountMove == 0 && amountMoveLP == 0) {
                            console.log(pad + pad + t + ': Account ' + acc + ' has <0.0001 MOVE/MOVE-LP to withdraw, skipping');
                            break;
                        }

                        console.log(pad + pad + t + ': Account ' + acc + ' withdraws ' + (amountMove/1000000.0) + ' MOVE and ' + (amountMoveLP/1000000.0) + ' MOVE-LP');
                        console.log(pad + pad + pad + 'staked MOVE:' + (stakedMOVE/1000000.0) + ', staked MOVE-LP:' + (stakedMOVELP/1000000.0));

                        await this.st.withdraw(web3.utils.toBN(amountMove).imuln(1000000).imuln(1000000), web3.utils.toBN(amountMoveLP).imuln(1000000).imuln(1000000), { from: accounts[acc+1] });

                        if (acc === 0) {
                            account1balanceMOVE += amountMove;
                            account1balanceMOVELP += amountMoveLP;
                            account1stakedMOVE -= amountMove;
                            account1stakedMOVELP -= amountMoveLP;
                            account1bonusTokens += account1bonusP; // tokenize bonus
                            account1bonusP = 0;
                        } else if (acc === 1) {
                            account2balanceMOVE += amountMove;
                            account2balanceMOVELP += amountMoveLP;
                            account2stakedMOVE -= amountMove;
                            account2stakedMOVELP -= amountMoveLP;
                            account2bonusTokens += account2bonusP; // tokenize bonus
                            account2bonusP = 0;
                        } else {
                            account3balanceMOVE += amountMove;
                            account3balanceMOVELP += amountMoveLP;
                            account3stakedMOVE -= amountMove;
                            account3stakedMOVELP -= amountMoveLP;
                            account3bonusTokens += account3bonusP; // tokenize bonus
                            account3bonusP = 0;
                        }
                        stakedMOVE -= amountMove;

                        if (stakedMOVELP - stakedSLPMasterchef < amountMoveLP) {
                            // some SLP are unstaked from MasterChef
                            console.log(pad + pad + pad + 'ST unstakes:' + ((amountMoveLP - (stakedMOVELP - stakedSLPMasterchef))/1000000.0) + ' MOVE-LP from MasterChef to cover withdraw');
                            stakedSLPMasterchef -= (amountMoveLP - (stakedMOVELP - stakedSLPMasterchef))
                            if (stakedSLPMasterchef < 0) {
                                throw "Masterchef staked balance is negative";
                            }    
                        }

                        stakedMOVELP -= amountMoveLP;
                        break;
                    case 6:
                    case 7:
                    case 8:
                        var acc = action % 3;
                        var amountCapMove = (acc === 0 ? account1balanceMOVE : (acc === 1 ? account2balanceMOVE : account3balanceMOVE));
                        if (amountCapMove < 100) {
                            amountCapMove = 0;
                        }
                        var totalMoveSupply = account1balanceMOVE + account1stakedMOVE + account2balanceMOVE + account2stakedMOVE + account3balanceMOVE + account3stakedMOVE;
                        if (amountCapMove > (totalMoveSupply/20)) {
                            amountCapMove = (totalMoveSupply/21);
                        }

                        var amountMove = (amountCapMove == 0) ? 0 : (Math.floor(Math.random() * (amountCapMove - 100)) + 100);
                        if (amountMove == 0) {
                            console.log(pad + pad + t + ': Account ' + acc + ' has <0.0001 MOVE to burn, skipping');
                            break;
                        }
                        amountMove = float2int(amountMove);

                        var accBonus = (acc === 0 ? (account1bonusP + account1bonusTokens) : (acc === 1 ? (account2bonusP + account2bonusTokens) : (account3bonusP + account3bonusTokens)));
                        console.log(pad + pad + t + ': Account ' + acc + ' burns ' + (amountMove/1000000.0) + ' MOVE, bonus available=' + (accBonus/1000000.0));

                        await this.hh.claimAndBurn.sendTransaction(web3.utils.toBN(Math.floor(amountMove)).imuln(1000000).imuln(1000000), { from: accounts[acc+1] });

                        var endowmentAmount = endowmentBalance * amountMove / totalMoveSupply;

                        var bonusAmount = float2int(accBonus);
                        if (bonusAmount > endowmentAmount) {
                            bonusAmount = float2int(endowmentAmount);
                        }
                        endowmentAmount = float2int(endowmentAmount * 4);
                        
                        endowmentBalance -= endowmentAmount;
                        bonusBalance -= bonusAmount;

                        var moveBefore = (acc === 0 ? account1balanceMOVE : (acc === 1 ? account2balanceMOVE : account3balanceMOVE));

                        if (acc === 0) {
                            account1burned += amountMove;
                            account1balanceMOVE -= amountMove;
                            account1usdc += endowmentAmount + bonusAmount;
                            if (bonusAmount > account1bonusP) {
                                account1bonusTokens -= (bonusAmount - account1bonusP);
                                account1bonusP = 0;
                            } else {
                                account1bonusP -= bonusAmount;
                            }
                        } else if (acc === 1) {
                            account2burned += amountMove;
                            account2balanceMOVE -= amountMove;
                            account2usdc += endowmentAmount + bonusAmount;
                            if (bonusAmount > account2bonusP) {
                                account2bonusTokens -= (bonusAmount - account2bonusP);
                                account2bonusP = 0;
                            } else {
                                account2bonusP -= bonusAmount;
                            }
                        } else if (acc === 2) {
                            account3burned += amountMove;
                            account3balanceMOVE -= amountMove;
                            account3usdc += endowmentAmount + bonusAmount;
                            if (bonusAmount > account3bonusP) {
                                account3bonusTokens -= (bonusAmount - account3bonusP);
                                account3bonusP = 0;
                            } else {
                                account3bonusP -= bonusAmount;
                            }
                        }

                        var moveAfter = (acc === 0 ? account1balanceMOVE : (acc === 1 ? account2balanceMOVE : account3balanceMOVE));

                        console.log(pad + pad + pad + "Endowment balance: " + (endowmentBalance/1000000.0));
                        console.log(pad + pad + pad + "Total MOVE supply: " + (totalMoveSupply/1000000.0));
                        console.log(pad + pad + pad + "MOVE amount to burn: " + (amountMove/1000000.0) + " account MOVE before:" + (moveBefore/1000000.0) + ", after:" + (moveAfter/1000000.0));
                        console.log(pad + pad + pad + "Endowment portion amount: " + (endowmentAmount/1000000.0) + ", bonus portion amount: " + (bonusAmount/1000000.0));
                        break;
                    case 9:
                        // SmartTreasury receives rewards
                        var amount = Math.floor(Math.random() * 100000000) + 10;
                        amount = (float2int(amount/2))*2; //make it odd number so no int errors
                        console.log(pad + pad + t + ': SmartTreasury receives ' + (amount/1000000.0) + ' USDC of yield');
                        await this.st.receiveProfit.sendTransaction(web3.utils.toBN(Math.floor(amount)), { from: accounts[0] });
                        if (stakedMOVE == 0 && stakedMOVELP == 0) {
                            // all goes to endowment
                            endowmentBalance += float2int((amount));
                        } else {
                            // endowment and bonuses
                            var bonusPortion = float2int((amount/2));
                            endowmentBalance += float2int((amount/2));
                            bonusBalance += bonusPortion;

                            // distribute bonuses proportionally
                            var totalWeight = (account1stakedMOVE + account2stakedMOVE + account3stakedMOVE) * 1000 +
                                                 (account1stakedMOVELP + account2stakedMOVELP + account3stakedMOVELP) * 2500;
                            account1bonusP += float2int(bonusPortion * (account1stakedMOVE * 1000 / totalWeight + account1stakedMOVELP * 2500 / totalWeight));
                            account2bonusP += float2int(bonusPortion * (account2stakedMOVE * 1000 / totalWeight + account2stakedMOVELP * 2500 / totalWeight));
                            account3bonusP += float2int(bonusPortion * (account3stakedMOVE * 1000 / totalWeight + account3stakedMOVELP * 2500 / totalWeight));
                        }
                        break;
                    case 10:
                        var amountSLP = Math.floor(Math.random() * (stakedMOVELP - stakedSLPMasterchef));
                        console.log(pad + pad + t + ': ST stakes ' + amountSLP + ' SLP in MasterChef, MasterChef balance before: ' + stakedSLPMasterchef);
                        await this.st.depositSLP(web3.utils.toBN(amountSLP), { from: accounts[0] });
                        stakedSLPMasterchef += amountSLP;
                        break;
                    case 11:
                        var amountSLP = Math.floor(Math.random() * (stakedSLPMasterchef));
                        console.log(pad + pad + t + ': ST withdraws ' + amountSLP + ' SLP from MasterChef, MasterChef balance before: ' + stakedSLPMasterchef);
                        await this.st.withdrawSLP(web3.utils.toBN(amountSLP), { from: accounts[0] });
                        stakedSLPMasterchef -= amountSLP;
                        if (stakedSLPMasterchef < 0) {
                            throw "Masterchef staked balance is negative";
                        }
                        break;
                }

                time.increase(6 * 3600);

                // check metrics
                var realEndowmentBalance = (await this.st.endowmentBalance()).toNumber();
                expect(Math.abs(realEndowmentBalance - endowmentBalance)).to.lessThan(100);
                var realBonusBalance = (await this.st.bonusBalance()).toNumber();
                expect(Math.abs(realBonusBalance - bonusBalance)).to.lessThan(100);
                var realUSDCinST = (await this.mockusdc.balanceOf(this.st.address)).toNumber();
                expect(Math.abs(realUSDCinST - (endowmentBalance+bonusBalance))).to.lessThan(100);
                var realUSDCacc1 = (await this.mockusdc.balanceOf(accounts[1])).toNumber();
                expect(Math.abs(realUSDCacc1 - account1usdc)).to.lessThan(100);
                var realUSDCacc2 = (await this.mockusdc.balanceOf(accounts[2])).toNumber();
                expect(Math.abs(realUSDCacc2 - account2usdc)).to.lessThan(100);
                var realUSDCacc3 = (await this.mockusdc.balanceOf(accounts[3])).toNumber();
                expect(Math.abs(realUSDCacc3 - account3usdc)).to.lessThan(100);
                
                expect((await this.st.userInfoMove(accounts[1]))[0].toString()).to.equal(web3.utils.toBN(account1stakedMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.st.userInfoMove(accounts[3]))[0].toString()).to.equal(web3.utils.toBN(account3stakedMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.st.userInfoMove(accounts[2]))[0].toString()).to.equal(web3.utils.toBN(account2stakedMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.st.userInfoMoveEthLP(accounts[1]))[0].toString()).to.equal(web3.utils.toBN(account1stakedMOVELP).imuln(1000000).imuln(1000000).toString());
                expect((await this.st.userInfoMoveEthLP(accounts[2]))[0].toString()).to.equal(web3.utils.toBN(account2stakedMOVELP).imuln(1000000).imuln(1000000).toString());
                expect((await this.st.userInfoMoveEthLP(accounts[3]))[0].toString()).to.equal(web3.utils.toBN(account3stakedMOVELP).imuln(1000000).imuln(1000000).toString());

                expect((await this.mover.balanceOf(accounts[1])).toString()).to.equal(web3.utils.toBN(account1balanceMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.mover.balanceOf(accounts[2])).toString()).to.equal(web3.utils.toBN(account2balanceMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.mover.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN(account3balanceMOVE).imuln(1000000).imuln(1000000).toString());
                expect((await this.movelpmock.balanceOf(accounts[1])).toString()).to.equal(web3.utils.toBN(account1balanceMOVELP).imuln(1000000).imuln(1000000).toString());
                expect((await this.movelpmock.balanceOf(accounts[2])).toString()).to.equal(web3.utils.toBN(account2balanceMOVELP).imuln(1000000).imuln(1000000).toString());
                expect((await this.movelpmock.balanceOf(accounts[3])).toString()).to.equal(web3.utils.toBN(account3balanceMOVELP).imuln(1000000).imuln(1000000).toString());

                var realAccount1BonusP = (await this.st.pendingBonus(accounts[1])).toNumber();
                var realAccount2BonusP = (await this.st.pendingBonus(accounts[2])).toNumber();
                var realAccount3BonusP = (await this.st.pendingBonus(accounts[3])).toNumber();
                expect(Math.abs(realAccount1BonusP - account1bonusP)).to.lessThan(100);
                expect(Math.abs(realAccount2BonusP - account2bonusP)).to.lessThan(100);
                expect(Math.abs(realAccount3BonusP - account3bonusP)).to.lessThan(100);

                var realAccount1BonusT = (await this.st.balanceOf(accounts[1])).toNumber();
                var realAccount2BonusT = (await this.st.balanceOf(accounts[2])).toNumber();
                var realAccount3BonusT = (await this.st.balanceOf(accounts[3])).toNumber();
                expect(Math.abs(realAccount1BonusT - account1bonusTokens)).to.lessThan(100);
                expect(Math.abs(realAccount2BonusT - account2bonusTokens)).to.lessThan(100);
                expect(Math.abs(realAccount3BonusT - account3bonusTokens)).to.lessThan(100);
            }
            console.log(pad + pad + 'STEP ' + i + ' FINISHED');

            var dailyAPYReal = (await this.st.getDPYPerMoveToken()).div(web3.utils.toBN('1000000000000')).toNumber()/1000000.0;
            var inceptionTSPool = (await this.st.inceptionTimestamp()).toNumber();
            var daysPassed = ((await time.latest()).toNumber() - inceptionTSPool) / 86400.0;

            console.log(pad + pad + 'account 1: starting MOVE=' + (account1startMOVE/1000000.0) + ', MOVELP=' + (account1startMOVELP/1000000.0) + ', current MOVE=' + (account1balanceMOVE/1000000.0) + ', MOVELP=' + (account1balanceMOVELP/1000000.0) + ", staked MOVE=" + (account1stakedMOVE/1000000.0) + ", MOVELP=" + (account1stakedMOVELP/1000000.0));
            console.log(pad + pad + 'account 2: starting MOVE=' + (account2startMOVE/1000000.0) + ', MOVELP=' + (account2startMOVELP/1000000.0) + ', current MOVE=' + (account2balanceMOVE/1000000.0) + ', MOVELP=' + (account2balanceMOVELP/1000000.0) + ", staked MOVE=" + (account2stakedMOVE/1000000.0) + ", MOVELP=" + (account2stakedMOVELP/1000000.0));
            console.log(pad + pad + 'account 3: starting MOVE=' + (account3startMOVE/1000000.0) + ', MOVELP=' + (account3startMOVELP/1000000.0) + ', current MOVE=' + (account3balanceMOVE/1000000.0) + ', MOVELP=' + (account3balanceMOVELP/1000000.0) + ", staked MOVE=" + (account3stakedMOVE/1000000.0) + ", MOVELP=" + (account3stakedMOVELP/1000000.0));
            expect(account1startMOVE).to.equal(account1balanceMOVE+account1stakedMOVE+account1burned);
            expect(account2startMOVE).to.equal(account2balanceMOVE+account2stakedMOVE+account2burned);
            expect(account3startMOVE).to.equal(account3balanceMOVE+account3stakedMOVE+account3burned);
            expect(account1startMOVELP).to.equal(account1balanceMOVELP+account1stakedMOVELP);
            expect(account2startMOVELP).to.equal(account2balanceMOVELP+account2stakedMOVELP);
            expect(account3startMOVELP).to.equal(account3balanceMOVELP+account3stakedMOVELP);

            console.log(pad + pad + 'account 1: bonus pending=' + account1bonusP + ', tokens=' + account1bonusTokens);
            console.log(pad + pad + 'account 2: bonus pending=' + account2bonusP + ', tokens=' + account2bonusTokens);
            console.log(pad + pad + 'account 3: bonus pending=' + account3bonusP + ', tokens=' + account3bonusTokens);

            console.log(pad + pad + 'account 1: burned MOVE=' + account1burned + ', USDC received=' + account1usdc);
            console.log(pad + pad + 'account 2: burned MOVE=' + account2burned + ', USDC received=' + account2usdc);
            console.log(pad + pad + 'account 3: burned MOVE=' + account3burned + ', USDC received=' + account3usdc);

            var inceptionTS = (await this.st.inceptionTimestamp()).toNumber();
            var daysPassed = ((await time.latest()).toNumber() - inceptionTS) / 86400.0;
            var calcAPY = 100.0 * endowmentBalance / daysPassed / stakedMOVE; // LP is mock, doesn't 'contain' MOVE

            console.log(pad + pad + 'treasury endowment balance=' + (endowmentBalance/1000000.0) + ', bonus balance=' + (bonusBalance/1000000.0));
            console.log(pad + pad + 'daily percentage yield=' + dailyAPYReal + ' (calculated=' + calcAPY + '), days since inception=' + daysPassed);
            expect(Math.abs(dailyAPYReal - calcAPY) * 1000).to.lessThan(100);

            var acc1sushi = (await this.mocksushi.balanceOf(accounts[1])).toString();
            var acc2sushi = (await this.mocksushi.balanceOf(accounts[2])).toString();
            var acc3sushi = (await this.mocksushi.balanceOf(accounts[3])).toString();
            console.log(pad + pad + 'account 1 sushi: ' + acc1sushi + ', account 2 sushi: ' + acc2sushi + ', account 3 sushi: ' + acc3sushi);
            
            var sushiaccumulated = (await this.st.treasurySushi()).toString();
            console.log(pad + pad + 'treasury accumulated sushi: ' + sushiaccumulated);
        }
    });
});