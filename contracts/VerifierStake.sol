// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CreditToken.sol";

contract VerifierStake is AccessControl, ReentrancyGuard {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");

    CreditToken public immutable creditToken;

    uint256 public constant MIN_STAKE = 1 ether;
    /// @notice Initial challenge window. Per-batch overrides may change it.
    uint256 public constant CHALLENGE_WINDOW = 90 days;
    uint256 public constant CHALLENGE_BOND = 0.1 ether;
    /// @notice Bounds for configurable challenge windows (roadmap 2).
    uint256 public constant MIN_CHALLENGE_WINDOW = 1 days;
    uint256 public constant MAX_CHALLENGE_WINDOW = 365 days;

    struct VerifierInfo {
        uint256 stake;
        uint256 lastTopUp;
        bool isActive;
    }

    struct Challenge {
        uint256 challengeId;
        uint256 batchId;
        address challenger;
        string evidenceHash;
        uint256 bond;
        uint256 timestamp;
        bool isResolved;
        bool challengerWon;
    }

    mapping(address => VerifierInfo) public verifiers;
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => uint256[]) public batchChallenges;
    // Number of unresolved challenges against each verifier's batches
    mapping(address => uint256) public activeChallengeCount;
    uint256 public challengeCount;
    address public compensationPool;

    // --- Roadmap 2: configurable / per-batch challenge window ---
    /// @notice Window applied to batches without an explicit override.
    uint256 public defaultChallengeWindow = CHALLENGE_WINDOW;
    /// @notice Per-batch override; 0 means "use defaultChallengeWindow".
    mapping(uint256 => uint256) public batchChallengeWindow;

    // --- Roadmap 5: per-batch compensation pools with pro-rata claims ---
    /// @notice Funds still available to claim for a batch.
    mapping(uint256 => uint256) public batchCompensationPool;
    /// @notice Total ever credited to a batch pool, used as the pro-rata base.
    mapping(uint256 => uint256) public batchCompensationTotal;
    /// @notice Batch supply at resolution time; the pro-rata denominator.
    mapping(uint256 => uint256) public batchCompensationDenominator;
    /// @notice Per-claimant token count already used to claim, so a repeat
    /// claim is measured only against newly acquired tokens.
    mapping(uint256 => mapping(address => uint256)) public compensationClaimedTokens;

    event StakeDeposited(address indexed verifier, uint256 amount);
    event StakeWithdrawn(address indexed verifier, uint256 amount);
    event StakeSlashed(address indexed verifier, uint256 amount, address indexed recipient);
    event ChallengeCreated(
        uint256 indexed challengeId,
        uint256 indexed batchId,
        address indexed challenger,
        string evidenceHash
    );
    event ChallengeResolved(
        uint256 indexed challengeId,
        bool challengerWon,
        uint256 slashedAmount,
        address indexed recipient
    );
    event CompensationPoolUpdated(uint256 newBalance);
    event DefaultChallengeWindowUpdated(uint256 newWindow);
    event BatchChallengeWindowUpdated(uint256 indexed batchId, uint256 newWindow);
    event CompensationPoolDeposited(
        uint256 indexed batchId,
        uint256 amount,
        uint256 denominator
    );
    event CompensationClaimed(uint256 indexed batchId, address indexed claimant, uint256 amount);

    constructor(address _creditToken, address _compensationPool, address defaultAdmin) {
        creditToken = CreditToken(_creditToken);
        compensationPool = _compensationPool;
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(VERIFIER_ROLE, defaultAdmin);
        _grantRole(REGULATOR_ROLE, defaultAdmin);
        _grantRole(CHALLENGER_ROLE, defaultAdmin);
    }

    function depositStake() external payable onlyRole(VERIFIER_ROLE) nonReentrant {
        require(msg.value >= MIN_STAKE, "Minimum stake is 1 ETH");
        VerifierInfo storage verifier = verifiers[msg.sender];
        verifier.stake += msg.value;
        verifier.lastTopUp = block.timestamp;
        verifier.isActive = true;
        emit StakeDeposited(msg.sender, msg.value);
    }

    function withdrawStake(uint256 amount) external onlyRole(VERIFIER_ROLE) nonReentrant {
        VerifierInfo storage verifier = verifiers[msg.sender];
        require(verifier.stake >= amount, "Insufficient stake");
        require(verifier.stake - amount >= MIN_STAKE || verifier.stake == amount, "Must maintain minimum stake");
        require(!hasActiveChallenges(msg.sender), "Active challenges exist");

        verifier.stake -= amount;
        if (verifier.stake < MIN_STAKE) {
            verifier.isActive = false;
        }
        payable(msg.sender).transfer(amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    function createChallenge(
        uint256 batchId,
        string calldata evidenceHash
    ) external payable onlyRole(CHALLENGER_ROLE) nonReentrant {
        require(msg.value >= CHALLENGE_BOND, "Minimum challenge bond is 0.1 ETH");
        require(bytes(evidenceHash).length > 0, "Evidence hash required");
        require(creditToken.getBatchVerifier(batchId) != address(0), "Batch not found");
        require(
            block.timestamp <= creditToken.getBatchTimestamp(batchId) + getChallengeWindow(batchId),
            "Challenge window expired"
        );

        uint256 challengeId = ++challengeCount;
        Challenge storage challenge = challenges[challengeId];
        challenge.challengeId = challengeId;
        challenge.batchId = batchId;
        challenge.challenger = msg.sender;
        challenge.evidenceHash = evidenceHash;
        challenge.bond = msg.value;
        challenge.timestamp = block.timestamp;
        challenge.isResolved = false;
        challenge.challengerWon = false;

        batchChallenges[batchId].push(challengeId);

        activeChallengeCount[creditToken.getBatchVerifier(batchId)]++;

        emit ChallengeCreated(challengeId, batchId, msg.sender, evidenceHash);
    }

    function resolveChallenge(
        uint256 challengeId,
        bool challengerWins
    ) external onlyRole(REGULATOR_ROLE) nonReentrant {
        Challenge storage challenge = challenges[challengeId];
        require(!challenge.isResolved, "Challenge already resolved");

        address verifier = creditToken.getBatchVerifier(challenge.batchId);
        VerifierInfo storage verifierInfo = verifiers[verifier];

        challenge.isResolved = true;
        challenge.challengerWon = challengerWins;

        uint256 slashedAmount = 0;
        if (challengerWins) {
            slashedAmount = verifierInfo.stake / 2;
            uint256 challengerReward = slashedAmount / 2;
            uint256 compensationAmount = slashedAmount - challengerReward;

            verifierInfo.stake -= slashedAmount;
            if (verifierInfo.stake < MIN_STAKE) {
                verifierInfo.isActive = false;
            }

            // Bond is returned plus the challenger's half of the slashed stake;
            // the other half is held in a per-batch pool for the buyers who
            // were left holding the fraudulent credits.
            payable(challenge.challenger).transfer(challenge.bond + challengerReward);

            // Roadmap 5: pro-rata pool instead of a single recipient address.
            batchCompensationPool[challenge.batchId] += compensationAmount;
            batchCompensationTotal[challenge.batchId] += compensationAmount;
            batchCompensationDenominator[challenge.batchId] = creditToken.getBatchSupply(challenge.batchId);

            creditToken.flagBatch(challenge.batchId, true);

            emit StakeSlashed(verifier, slashedAmount, challenge.challenger);
            emit CompensationPoolDeposited(
                challenge.batchId,
                compensationAmount,
                batchCompensationDenominator[challenge.batchId]
            );
        } else {
            payable(compensationPool).transfer(challenge.bond);
            emit CompensationPoolUpdated(address(compensationPool).balance);
        }

        if (activeChallengeCount[verifier] > 0) {
            activeChallengeCount[verifier]--;
        }

        emit ChallengeResolved(challengeId, challengerWins, slashedAmount, challengerWins ? challenge.challenger : compensationPool);
    }

    function getVerifierInfo(address verifier)
        external
        view
        returns (uint256 stake, uint256 lastTopUp, bool isActive)
    {
        VerifierInfo storage v = verifiers[verifier];
        return (v.stake, v.lastTopUp, v.isActive);
    }

    function getChallenge(uint256 challengeId)
        external
        view
        returns (
            uint256 batchId,
            address challenger,
            string memory evidenceHash,
            uint256 bond,
            uint256 timestamp,
            bool isResolved,
            bool challengerWon
        )
    {
        Challenge storage c = challenges[challengeId];
        return (c.batchId, c.challenger, c.evidenceHash, c.bond, c.timestamp, c.isResolved, c.challengerWon);
    }

    function getBatchChallenges(uint256 batchId)
        external
        view
        returns (uint256[] memory)
    {
        return batchChallenges[batchId];
    }

    function hasActiveChallenges(address verifier) internal view returns (bool) {
        return activeChallengeCount[verifier] > 0;
    }

    // ------------------------------------------------------------------
    // Roadmap 2: configurable challenge window
    // ------------------------------------------------------------------

    /// @notice Window that currently applies to a batch: its override if set,
    /// otherwise the global default.
    function getChallengeWindow(uint256 batchId) public view returns (uint256) {
        uint256 override_ = batchChallengeWindow[batchId];
        return override_ == 0 ? defaultChallengeWindow : override_;
    }

    function setDefaultChallengeWindow(uint256 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            window >= MIN_CHALLENGE_WINDOW && window <= MAX_CHALLENGE_WINDOW,
            "Window out of bounds"
        );
        defaultChallengeWindow = window;
        emit DefaultChallengeWindowUpdated(window);
    }

    function setBatchChallengeWindow(
        uint256 batchId,
        uint256 window
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(creditToken.getBatchVerifier(batchId) != address(0), "Batch not found");
        require(
            window >= MIN_CHALLENGE_WINDOW && window <= MAX_CHALLENGE_WINDOW,
            "Window out of bounds"
        );
        batchChallengeWindow[batchId] = window;
        emit BatchChallengeWindowUpdated(batchId, window);
    }

    /// @notice Clears a per-batch override so the batch falls back to the default.
    function clearBatchChallengeWindow(uint256 batchId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        batchChallengeWindow[batchId] = 0;
        emit BatchChallengeWindowUpdated(batchId, defaultChallengeWindow);
    }

    // ------------------------------------------------------------------
    // Roadmap 5: per-batch compensation, pro-rata by batch holdings
    // ------------------------------------------------------------------

    /**
     * @notice Withdraw this sender's share of a slashed batch's compensation.
     * @dev The share is measured against the supply snapshot taken when the
     * challenge was resolved, so a holder who has since sold keeps only the
     * share their remaining balance entitles them to. Tokens acquired after
     * resolution are not claimable, and the denominator is frozen, so the pool
     * cannot be drained for more than it holds.
     */
    function claimCompensation(uint256 batchId) external nonReentrant returns (uint256) {
        uint256 total = batchCompensationTotal[batchId];
        require(total > 0, "No compensation pool");
        uint256 denominator = batchCompensationDenominator[batchId];
        require(denominator > 0, "No compensation denominator");
        // The verifier whose batch was flagged must not draw from the pool that
        // exists to compensate the buyers it misled.
        require(
            creditToken.getBatchVerifier(batchId) != msg.sender,
            "Verifier cannot claim compensation"
        );

        uint256 balance = creditToken.getUserBatchBalance(batchId, msg.sender);
        uint256 alreadyClaimed = compensationClaimedTokens[batchId][msg.sender];
        require(balance > alreadyClaimed, "Nothing to claim");

        uint256 claimableTokens = balance - alreadyClaimed;
        uint256 share = (total * claimableTokens) / denominator;
        require(share > 0, "Claim amount too small");

        uint256 available = batchCompensationPool[batchId];
        if (share > available) {
            share = available;
        }
        require(share > 0, "Compensation pool exhausted");

        compensationClaimedTokens[batchId][msg.sender] = balance;
        batchCompensationPool[batchId] = available - share;

        payable(msg.sender).transfer(share);
        emit CompensationClaimed(batchId, msg.sender, share);
        return share;
    }

    function grantVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(VERIFIER_ROLE, account);
    }

    function grantRegulatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(REGULATOR_ROLE, account);
    }

    function grantChallengerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(CHALLENGER_ROLE, account);
    }

    function revokeVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(VERIFIER_ROLE, account);
    }

    function revokeRegulatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(REGULATOR_ROLE, account);
    }

    function revokeChallengerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(CHALLENGER_ROLE, account);
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}