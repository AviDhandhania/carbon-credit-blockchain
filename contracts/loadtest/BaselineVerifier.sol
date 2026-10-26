// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../CreditToken.sol";

/**
 * @title BaselineVerifier
 * @notice LOAD-TEST BASELINE ONLY — not part of the product, not deployed by
 *         `scripts/deploy.js`, and intentionally wired into no application code.
 *
 * This contract exists to answer one research question (§9 of the experiment
 * specification): what performance does a carbon-credit verification system
 * have when it does **not** implement the proposed verifier-staking and
 * 90-day challenge mechanism?
 *
 * It is the "existing/baseline approach" in the comparison:
 *
 *   BaselineVerifier.submitProject  -> record a verification request   (no bond)
 *   BaselineVerifier.approveProject -> approve it, minting credits     (no stake)
 *
 * There is deliberately:
 *   - no stake requirement, no MIN_STAKE;
 *   - no challenge window, no CHALLENGE_BOND;
 *   - no challenge, no slashing, no resolution path, no multisig.
 *
 * Credits are issued through the *same* CreditToken as the proposed system, so
 * the only difference between the two systems under test is the staking and
 * challenge layer — exactly the variable the experiment isolates.
 *
 * Compilation: Hardhat compiles everything under `contracts/`, so this file is
 * built on `npx hardhat compile`. Its presence changes no existing address:
 * `loadtest/setup-baseline.js` deploys it *after* the six product contracts, so
 * the deterministic addresses in `frontend/src/utils/contracts.js` do not move.
 */
contract BaselineVerifier {
    struct Project {
        string projectId;
        string ipfsHash;
        uint256 amount;
        address verifier;
        uint256 timestamp;
        bool approved;
    }

    CreditToken public immutable creditToken;

    Project[] private _projects;

    event ProjectSubmitted(uint256 indexed projectId, address indexed verifier, string projectId_);
    event ProjectApproved(uint256 indexed projectId, uint256 indexed batchId, address indexed verifier);

    constructor(address _creditToken) {
        require(_creditToken != address(0), "CreditToken required");
        creditToken = CreditToken(_creditToken);
    }

    /**
     * @notice Record a verification request. No role, no bond, no minimum.
     * @return projectId_ 1-based id of the stored project.
     */
    function submitProject(
        string calldata projectId,
        string calldata ipfsHash,
        uint256 amount
    ) external returns (uint256 projectId_) {
        _projects.push(
            Project({
                projectId: projectId,
                ipfsHash: ipfsHash,
                amount: amount,
                verifier: msg.sender,
                timestamp: block.timestamp,
                approved: false
            })
        );
        projectId_ = _projects.length;
        emit ProjectSubmitted(projectId_, msg.sender, projectId);
    }

    /**
     * @notice Approve the project and issue its credits through CreditToken.
     *
     * There is no stake to deposit and no challenge window to open: approval is
     * final in this transaction, and the batch becomes immediately
     * unchallengeable.
     *
     * Requires this contract to hold MINTER_ROLE on CreditToken (granted by
     * `loadtest/setup-baseline.js`).
     */
    function approveProject(uint256 projectId_) external returns (uint256 batchId) {
        require(projectId_ >= 1 && projectId_ <= _projects.length, "Project not found");
        Project storage project = _projects[projectId_ - 1];
        require(!project.approved, "Already approved");
        require(project.verifier == msg.sender, "Not project verifier");

        project.approved = true;
        batchId = creditToken.mintBatch(project.projectId, project.ipfsHash, project.amount);
        emit ProjectApproved(projectId_, batchId, msg.sender);
    }

    function projectCount() external view returns (uint256) {
        return _projects.length;
    }

    function isApproved(uint256 projectId_) external view returns (bool) {
        if (projectId_ < 1 || projectId_ > _projects.length) return false;
        return _projects[projectId_ - 1].approved;
    }

    function getProject(uint256 projectId_)
        external
        view
        returns (
            string memory projectId,
            string memory ipfsHash,
            uint256 amount,
            address verifier,
            uint256 timestamp,
            bool approved
        )
    {
        require(projectId_ >= 1 && projectId_ <= _projects.length, "Project not found");
        Project storage p = _projects[projectId_ - 1];
        return (p.projectId, p.ipfsHash, p.amount, p.verifier, p.timestamp, p.approved);
    }
}
