// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Minimal slice of VerifierStake this multisig drives.
 */
interface IChallengeResolver {
    function resolveChallenge(uint256 challengeId, bool challengerWins) external;
}

/**
 * @title RegulatorMultisig
 * @notice A threshold (default 3-of-5) approval gate for challenge resolutions.
 *
 * DA2 §4 called out the single-regulator address as the weakest trust
 * assumption in the design: one key decided whether a verifier was slashed,
 * which is exactly the kind of concentrated power the "public verifiability"
 * argument is meant to remove.
 *
 * This contract holds the REGULATOR_ROLE on VerifierStake instead of an EOA.
 * A resolution must be proposed once and approved by `threshold` distinct
 * owners before it can reach VerifierStake, so no single key can slash a
 * verifier or wave a fraudulent batch through.
 */
contract RegulatorMultisig {
    uint256 public immutable threshold;
    address public verifierStake;

    address[] private _owners;
    mapping(address => bool) public isOwner;

    struct Proposal {
        uint256 challengeId;
        bool challengerWins;
        uint256 approvals;
        bool executed;
        bool exists;
    }

    /// @notice One proposal per challenge id, so approvals can never cross wires.
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;

    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdUpdated(uint256 newThreshold);
    event VerifierStakeUpdated(address indexed verifierStake);
    event ResolutionProposed(
        uint256 indexed challengeId,
        bool challengerWins,
        address indexed proposer
    );
    event ResolutionApproved(uint256 indexed challengeId, address indexed owner, uint256 approvals);
    event ResolutionExecuted(uint256 indexed challengeId, bool challengerWins);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not an owner");
        _;
    }

    /**
     * @param initialOwners Regulator panel. Must be non-empty and duplicate-free.
     * @param initialThreshold Approvals required to execute (e.g. 3 for 3-of-5).
     * @param _verifierStake Address of the VerifierStake the panel governs.
     */
    constructor(address[] memory initialOwners, uint256 initialThreshold, address _verifierStake) {
        require(initialOwners.length > 0, "Owners required");
        require(
            initialThreshold > 0 && initialThreshold <= initialOwners.length,
            "Invalid threshold"
        );

        for (uint256 i = 0; i < initialOwners.length; i++) {
            address owner = initialOwners[i];
            require(owner != address(0), "Invalid owner");
            require(!isOwner[owner], "Duplicate owner");
            isOwner[owner] = true;
            _owners.push(owner);
            emit OwnerAdded(owner);
        }

        threshold = initialThreshold;
        verifierStake = _verifierStake;
        emit ThresholdUpdated(initialThreshold);
        emit VerifierStakeUpdated(_verifierStake);
    }

    function owners() external view returns (address[] memory) {
        return _owners;
    }

    function ownerCount() external view returns (uint256) {
        return _owners.length;
    }

    function addOwner(address owner) external onlyOwner {
        require(owner != address(0), "Invalid owner");
        require(!isOwner[owner], "Duplicate owner");
        isOwner[owner] = true;
        _owners.push(owner);
        emit OwnerAdded(owner);
    }

    function removeOwner(address owner) external onlyOwner {
        require(isOwner[owner], "Not an owner");
        require(_owners.length - 1 >= threshold, "Would drop below threshold");

        isOwner[owner] = false;
        for (uint256 i = 0; i < _owners.length; i++) {
            if (_owners[i] == owner) {
                _owners[i] = _owners[_owners.length - 1];
                _owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function setVerifierStake(address _verifierStake) external onlyOwner {
        require(_verifierStake != address(0), "Invalid address");
        verifierStake = _verifierStake;
        emit VerifierStakeUpdated(_verifierStake);
    }

    /**
     * @notice Open a resolution proposal. A challenge can only be proposed once,
     * because the outcome flag is what the approvals are bound to.
     */
    function proposeResolution(uint256 challengeId, bool challengerWins) external onlyOwner {
        Proposal storage proposal = proposals[challengeId];
        require(!proposal.exists, "Proposal already exists");

        proposal.challengeId = challengeId;
        proposal.challengerWins = challengerWins;
        proposal.exists = true;

        emit ResolutionProposed(challengeId, challengerWins, msg.sender);
    }

    /**
     * @notice Approve a proposal; executes automatically on reaching threshold.
     */
    function approveResolution(uint256 challengeId) external onlyOwner {
        Proposal storage proposal = proposals[challengeId];
        require(proposal.exists, "No such proposal");
        require(!proposal.executed, "Already executed");
        require(!approved[challengeId][msg.sender], "Already approved");

        approved[challengeId][msg.sender] = true;
        proposal.approvals += 1;

        emit ResolutionApproved(challengeId, msg.sender, proposal.approvals);

        if (proposal.approvals >= threshold) {
            _execute(challengeId);
        }
    }

    /// @notice Execute explicitly if a proposal already has enough approvals.
    function executeResolution(uint256 challengeId) external onlyOwner {
        Proposal storage proposal = proposals[challengeId];
        require(proposal.exists, "No such proposal");
        require(!proposal.executed, "Already executed");
        require(proposal.approvals >= threshold, "Threshold not reached");
        _execute(challengeId);
    }

    function _execute(uint256 challengeId) internal {
        Proposal storage proposal = proposals[challengeId];
        require(verifierStake != address(0), "VerifierStake not set");

        proposal.executed = true;
        IChallengeResolver(verifierStake).resolveChallenge(challengeId, proposal.challengerWins);

        emit ResolutionExecuted(challengeId, proposal.challengerWins);
    }
}
