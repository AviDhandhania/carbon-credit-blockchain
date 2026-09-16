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
    uint256 public constant CHALLENGE_WINDOW = 90 days;
    uint256 public constant CHALLENGE_BOND = 0.1 ether;

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
        require(block.timestamp <= creditToken.getBatchTimestamp(batchId) + CHALLENGE_WINDOW, "Challenge window expired");

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
            // the other half goes to the compensation pool.
            payable(challenge.challenger).transfer(challenge.bond + challengerReward);
            payable(compensationPool).transfer(compensationAmount);

            creditToken.flagBatch(challenge.batchId, true);

            emit StakeSlashed(verifier, slashedAmount, challenge.challenger);
            emit CompensationPoolUpdated(address(compensationPool).balance);
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