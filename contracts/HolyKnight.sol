// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./HolyToken.sol";


// HolyKnight is using LP to distribute Holyheld token
//
// it does not mint any HOLY tokens, they must be present on the
// contract's token balance. Balance is not intended to be refillable.
//
// Note that it's ownable and the owner wields tremendous power. The ownership
// will be transferred to a governance smart contract once HOLY is sufficiently
// distributed and the community can show to govern itself.
//
// Have fun reading it. Hopefully it's bug-free. God bless.
contract HolyKnight is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
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
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool. HOLYs to distribute per block.
        uint256 lastRewardCalcBlock;  // Last block number that HOLYs distribution occurs.
        uint256 accHolyPerShare; // Accumulated HOLYs per share, times 1e12. See below.
    }

    // The Holyheld token
    HolyToken public holytoken;
    // Dev address.
    address public devaddr;
    // Treasury address
    address public treasuryaddr;

    // The block number when HOLY mining starts.
    uint256 public startBlock;
    // The block number when HOLY mining targeted to end (if full allocation).
    uint256 public targetEndBlock;

    // Total amount of tokens to distribute
    uint256 public totalSupply;
    // Reserved amount of tokens (to add more pool gradually)
    uint256 public reservedSupply;

    // HOLY tokens created per block.
    uint256 public holyPerBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    
    // Info of each user that stakes LP tokens.
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
        uint256 _startreserve,
        uint256 _startBlock,
        uint256 _targetEndBlock
    ) public {
        holytoken = _token;

        devaddr = _devaddr;
        treasuryaddr = _treasuryaddr;

        //as knight is deployed by Holyheld token, transfer ownership to dev
        transferOwnership(_devaddr);

        totalSupply = _totalsupply;
        reservedSupply = _startreserve;

        startBlock = _startBlock;
        targetEndBlock = _targetEndBlock;
    }

    function setReserve(uint256 _reserveAmount) public onlyOwner {
        reservedSupply = _reserveAmount;
        updateHolyPerBlock();
    }

    function updateHolyPerBlock() internal {
        holyPerBlock = totalSupply.sub(reservedSupply).div(targetEndBlock.sub(startBlock));
        massUpdatePools();
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardCalcBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardCalcBlock: lastRewardCalcBlock,
            accHolyPerShare: 0
        }));
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
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
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

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardCalcBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardCalcBlock = block.number;
            return;
        }
        uint256 multiplier = block.number.sub(pool.lastRewardCalcBlock);
        uint256 tokenReward = multiplier.mul(holyPerBlock).mul(pool.allocPoint).div(totalAllocPoint);
        //no minting is required, the contract already has token balance allocated
        pool.accHolyPerShare = pool.accHolyPerShare.add(tokenReward.mul(1e12).div(lpSupply));
        pool.lastRewardCalcBlock = block.number;
    }

    // Deposit LP tokens to HolyKnight for HOLY allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount.mul(pool.accHolyPerShare).div(1e12).sub(user.rewardDebt);
            safeTokenTransfer(msg.sender, pending);
        }
        pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        user.amount = user.amount.add(_amount);
        user.rewardDebt = user.amount.mul(pool.accHolyPerShare).div(1e12);
        totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].add(_amount);
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from HolyKnight.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending = user.amount.mul(pool.accHolyPerShare).div(1e12).sub(user.rewardDebt);
        safeTokenTransfer(msg.sender, pending);
        user.amount = user.amount.sub(_amount);
        user.rewardDebt = user.amount.mul(pool.accHolyPerShare).div(1e12);
        pool.lpToken.safeTransfer(address(msg.sender), _amount);
        totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].sub(_amount);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        totalStaked[address(pool.lpToken)] = totalStaked[address(pool.lpToken)].sub(user.amount);
        user.amount = 0;
        user.rewardDebt = 0;
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
    function putToTreasury(address token) public onlyOwner {
        uint256 availablebalance = IERC20(token).balanceOf(address(this)) - totalStaked[token];
        require(availablebalance > 0, "not enough tokens");
        putToTreasuryAmount(token, availablebalance);
    }

    // Send yield amount realized from holding LP tokens to the treasury
    function putToTreasuryAmount(address token, uint256 _amount) public onlyOwner {
        uint256 userbalances = totalStaked[token];
        uint256 lptokenbalance = IERC20(token).balanceOf(address(this));
        require(token != address(holytoken), "cannot transfer holy tokens");
        require(_amount < lptokenbalance - userbalances, "not enough tokens");
        IERC20(token).safeTransfer(treasuryaddr, _amount);
        emit Treasury(token, treasuryaddr, _amount);
    }
}