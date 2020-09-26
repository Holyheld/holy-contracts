// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/Stakeable.sol";
import "./HolyToken.sol";


/**
 * @dev // HolyKnight is using LP to distribute Holyheld token
 *
 * it does not mint any HOLY tokens, they must be present on the
 * contract's token balance. Balance is not intended to be refillable.
 *
 * Note that it's ownable and the owner wields tremendous power. The ownership
 * will be transferred to a governance smart contract once HOLY is sufficiently
 * distributed and the community can show to govern itself.
 *
 * Have fun reading it. Hopefully it's bug-free. God bless.
 */
contract HolyKnight is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of HOLYs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accHolyPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accHolyPerShare` (and `lastRewardCalcBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
        // Thus every change in pool or allocation will result in recalculation of values
        // (otherwise distribution remains constant btwn blocks and will be properly calculated)
        uint256 stakedLPAmount;
    }

    // Info of each pool
    struct PoolInfo {
        IERC20 lpToken;              // Address of LP token contract
        uint256 allocPoint;          // How many allocation points assigned to this pool. HOLYs to distribute per block
        uint256 lastRewardCalcBlock; // Last block number for which HOLYs distribution is already calculated for the pool
        uint256 accHolyPerShare;     // Accumulated HOLYs per share, times 1e12. See below
        bool    stakeable;         // we should call deposit method on the LP tokens provided (used for e.g. vault staking)
        address stakeableContract;     // location where to deposit LP tokens if pool is stakeable
        IERC20  stakedHoldableToken;
    }

    // The Holyheld token
    HolyToken public holytoken;
    // Dev address
    address public devaddr;
    // Treasury address
    address public treasuryaddr;

    // The block number when HOLY mining starts
    uint256 public startBlock;
    // The block number when HOLY mining targeted to end (if full allocation).
    // used only for token distribution calculation, this is not a hard limit
    uint256 public targetEndBlock;

    // Total amount of tokens to distribute
    uint256 public totalSupply;
    // Reserved percent of HOLY tokens for current distribution (e.g. when pool allocation is intentionally not full)
    uint256 public reservedPercent;
    // HOLY tokens created per block, calculatable through updateHolyPerBlock()
    // updated once in the constructor and owner calling setReserve (if needed)
    uint256 public holyPerBlock;

    // Info of each pool
    PoolInfo[] public poolInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools
    uint256 public totalAllocPoint = 0;
    
    // Info of each user that stakes LP tokens
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;
    // Info of total amount of staked LP tokens by all users
    mapping (address => uint256) public totalStaked;



    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Treasury(address indexed token, address treasury, uint256 amount);

    constructor(
        HolyToken _token,
        address _devaddr,
        address _treasuryaddr,
        uint256 _totalsupply,
        uint256 _reservedPercent,
        uint256 _startBlock,
        uint256 _targetEndBlock
    ) public {
        holytoken = _token;

        devaddr = _devaddr;
        treasuryaddr = _treasuryaddr;

        // as knight is deployed by Holyheld token, transfer ownership to dev
        transferOwnership(_devaddr);

        totalSupply = _totalsupply;
        reservedPercent = _reservedPercent;

        startBlock = _startBlock;
        targetEndBlock = _targetEndBlock;

        // calculate initial token number per block
        updateHolyPerBlock();
    }

    // Reserve some percentage of HOLY token distribution
    // (e.g. initially, 10% of tokens are reserved for future pools to be added)
    function setReserve(uint256 _reservedPercent) public onlyOwner {
        reservedPercent = _reservedPercent;
        updateHolyPerBlock();
    }

    function updateHolyPerBlock() internal {
        // safemath substraction cannot overflow
        holyPerBlock = totalSupply.sub(totalSupply.mul(reservedPercent).div(100)).div(targetEndBlock.sub(startBlock));
        massUpdatePools();
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _stakeable, address _stakeableContract, IERC20 _stakedHoldableToken, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardCalcBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardCalcBlock: lastRewardCalcBlock,
            accHolyPerShare: 0,
            stakeable: _stakeable,
            stakeableContract: _stakeableContract,
            stakedHoldableToken: IERC20(_stakedHoldableToken)
        }));

        if(_stakeable)
        {
            _lpToken.approve(_stakeableContract, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
        }
    }

    // Update the given pool's HOLY allocation point. Can only be called by the owner.
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    // View function to see pending HOLYs on frontend.
    function pendingHoly(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accHolyPerShare = pool.accHolyPerShare;
        uint256 lpSupply = totalStaked[address(pool.lpToken)];
        if (block.number > pool.lastRewardCalcBlock && lpSupply != 0) {
            uint256 multiplier = block.number.sub(pool.lastRewardCalcBlock);
            uint256 tokenReward = multiplier.mul(holyPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
            accHolyPerShare = accHolyPerShare.add(tokenReward.mul(1e12).div(lpSupply));
        }
        return user.amount.mul(accHolyPerShare).div(1e12).sub(user.rewardDebt);
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date when lpSupply changes
    // For every deposit/withdraw/harvest pool recalculates accumulated token value
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardCalcBlock) {
            return;
        }
        uint256 lpSupply = totalStaked[address(pool.lpToken)];
        if (lpSupply == 0) {
            pool.lastRewardCalcBlock = block.number;
            return;
        }
        uint256 multiplier = block.number.sub(pool.lastRewardCalcBlock);
        uint256 tokenRewardAccumulated = multiplier.mul(holyPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
        // no minting is required, the contract already has token balance pre-allocated
        // accumulated HOLY per share is stored multiplied by 10^12 to allow small 'fractional' values
        pool.accHolyPerShare = pool.accHolyPerShare.add(tokenRewardAccumulated.mul(1e12).div(lpSupply));
        pool.lastRewardCalcBlock = block.number;
    }

    // Deposit LP tokens to HolyKnight for HOLY allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount.mul(pool.accHolyPerShare).div(1e12).sub(user.rewardDebt);
            if(pending > 0) {
                safeTokenTransfer(msg.sender, pending); //pay the earned tokens when user deposits
            }
        }
        // this condition would save some gas on harvest calls
        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount.add(_amount);
        }
        user.rewardDebt = user.amount.mul(pool.accHolyPerShare).div(1e12);

        totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].add(_amount);
        if (pool.stakeable) {
            uint256 prevbalance = pool.stakedHoldableToken.balanceOf(address(this));
            Stakeable(pool.stakeableContract).deposit(_amount);
            uint256 balancetoadd = pool.stakedHoldableToken.balanceOf(address(this)).sub(prevbalance);
            user.stakedLPAmount = user.stakedLPAmount.add(balancetoadd);
            // protect received tokens from moving to treasury
            totalStaked[address(pool.stakedHoldableToken)] = totalStaked[address(pool.stakedHoldableToken)].add(balancetoadd);
        }

        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from HolyKnight.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);

        uint256 pending = user.amount.mul(pool.accHolyPerShare).div(1e12).sub(user.rewardDebt);
        safeTokenTransfer(msg.sender, pending);
        
        if (pool.stakeable) {
            // reclaim back original LP tokens and withdraw all of them, regardless of amount
            Stakeable(pool.stakeableContract).withdraw(user.stakedLPAmount);
            totalStaked[address(pool.stakedHoldableToken)] = totalStaked[address(pool.stakedHoldableToken)].sub(user.stakedLPAmount);
            user.stakedLPAmount = 0;
            // even if returned amount is less (fees, etc.), return all that is available
            // (can be impacting treasury rewards if abused, but is not viable due to gas costs
            // and treasury yields can be claimed periodically)
            uint256 balance = pool.lpToken.balanceOf(address(this));
            if (user.amount < balance) {
                pool.lpToken.safeTransfer(address(msg.sender), user.amount);
            } else {
                pool.lpToken.safeTransfer(address(msg.sender), balance);
            }
            totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].sub(user.amount);
            user.amount = 0;
            user.rewardDebt = 0;
        } else {
            require(user.amount >= _amount, "withdraw: not good");
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
            totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].sub(_amount);
            user.amount = user.amount.sub(_amount);
            user.rewardDebt = user.amount.mul(pool.accHolyPerShare).div(1e12);
        }
        
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];

        if (pool.stakeable) {
            // reclaim back original LP tokens and withdraw all of them, regardless of amount
            Stakeable(pool.stakeableContract).withdraw(user.stakedLPAmount);
            totalStaked[address(pool.stakedHoldableToken)] = totalStaked[address(pool.stakedHoldableToken)].sub(user.stakedLPAmount);
            user.stakedLPAmount = 0;
            uint256 balance = pool.lpToken.balanceOf(address(this));
            if (user.amount < balance) {
                pool.lpToken.safeTransfer(address(msg.sender), user.amount);
            } else {
                pool.lpToken.safeTransfer(address(msg.sender), balance);
            }
        } else {
            pool.lpToken.safeTransfer(address(msg.sender), user.amount);    
        }

        totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].sub(user.amount);
        user.amount = 0;
        user.rewardDebt = 0;
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
    }

    // Safe holyheld token transfer function, just in case if rounding error causes pool to not have enough HOLYs.
    function safeTokenTransfer(address _to, uint256 _amount) internal {
        uint256 balance = holytoken.balanceOf(address(this));
        if (_amount > balance) {
            holytoken.transfer(_to, balance);
        } else {
            holytoken.transfer(_to, _amount);
        }
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        require(msg.sender == devaddr, "forbidden");
        devaddr = _devaddr;
    }

    // Update treasury address by the previous treasury.
    function treasury(address _treasuryaddr) public {
        require(msg.sender == treasuryaddr, "forbidden");
        treasuryaddr = _treasuryaddr;
    }

    // Send yield on an LP token to the treasury
    // have just address (and not pid) as agrument to be able to recover
    // tokens that could be directly transferred and not present in pools
    function putToTreasury(address _token) public onlyOwner {
        uint256 availablebalance = getAvailableBalance(_token);
        require(availablebalance > 0, "not enough tokens");
        putToTreasuryAmount(_token, availablebalance);
    }

    // Send yield amount realized from holding LP tokens to the treasury
    function putToTreasuryAmount(address _token, uint256 _amount) public onlyOwner {
        require(_token != address(holytoken), "cannot transfer holy tokens");
        uint256 availablebalance = getAvailableBalance(_token);
        require(_amount <= availablebalance, "not enough tokens");
        IERC20(_token).safeTransfer(treasuryaddr, _amount);
        emit Treasury(_token, treasuryaddr, _amount);
    }

    // Get available token balance that can be put to treasury
    // For pools with internal staking, all lpToken balance is contract's
    // (bacause user tokens are converted to pool.stakedHoldableToken when depositing)
    // HOLY tokens themselves and user lpTokens are protected by this check
    function getAvailableBalance(address _token) internal view returns (uint256) {
        uint256 availablebalance = IERC20(_token).balanceOf(address(this)) - totalStaked[_token];
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            PoolInfo storage pool = poolInfo[pid]; //storage pointer used read-only
            if (pool.stakeable && address(pool.lpToken) == _token)
            {
                availablebalance = IERC20(_token).balanceOf(address(this));
                break;
            }
        }
        return availablebalance;
    }
}
