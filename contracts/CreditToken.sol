// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMRVOracle.sol";

contract CreditToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    /// @notice Held by the marketplace, the only caller allowed to move a named
    /// batch instead of the holder's oldest batches.
    bytes32 public constant BATCH_TRANSFER_ROLE = keccak256("BATCH_TRANSFER_ROLE");

    struct Batch {
        uint256 batchId;
        string projectId;
        address verifier;
        string ipfsHash;
        uint256 amount;
        uint256 timestamp;
        bool isRetired;
        bool isFlagged;
    }

    uint256 private _batchIds;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => mapping(address => uint256)) public batchBalances;
    mapping(address => uint256[]) public userBatches;
    /// @dev 1-based position of a batch inside userBatches[user], so a batch can
    /// be dropped in constant time instead of scanning the holder's whole list.
    mapping(address => mapping(uint256 => uint256)) private _batchIndex;
    /// @notice Number of distinct batches a holder currently has a balance in.
    mapping(address => uint256) public activeBatchCount;
    /// @notice Child batch -> batch it was fractionalized from (0 for originals).
    mapping(uint256 => uint256) public batchParent;
    /// @notice Circulating supply per batch, so a compensation pool can be
    /// divided pro-rata across holders. Invariant: sum(batchSupply) == totalSupply.
    mapping(uint256 => uint256) public batchSupply;

    /// @notice Optional external MRV feed. When unset (address(0)) minting skips
    /// attestation, preserving the original permissionless-mint behaviour.
    IMRVOracle public mrvOracle;

    event BatchMinted(
        uint256 indexed batchId,
        string projectId,
        address indexed verifier,
        string ipfsHash,
        uint256 amount,
        uint256 timestamp
    );
    event BatchRetired(uint256 indexed batchId, uint256 amount);
    event BatchFlagged(uint256 indexed batchId, bool flagged);
    event BatchSplit(
        uint256 indexed parentBatchId,
        uint256 indexed childBatchId,
        address indexed holder,
        uint256 amount
    );
    event MRVOracleUpdated(address indexed newOracle);

    constructor(address defaultAdmin) ERC20("Carbon Credit", "CC") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, defaultAdmin);
        _grantRole(VERIFIER_ROLE, defaultAdmin);
    }

    function mintBatch(
        string calldata projectId,
        string calldata ipfsHash,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(bytes(projectId).length > 0, "Project ID required");
        require(bytes(ipfsHash).length > 0, "IPFS hash required");

        // Optional MRV attestation (roadmap 3.1). Skipped when no oracle is set.
        if (address(mrvOracle) != address(0)) {
            require(mrvOracle.isProjectApproved(projectId), "Project not approved by MRV oracle");
            require(
                mrvOracle.getProjectHash(projectId) == keccak256(bytes(ipfsHash)),
                "IPFS hash does not match MRV oracle"
            );
        }

        uint256 batchId = ++_batchIds;
        Batch storage batch = batches[batchId];
        batch.batchId = batchId;
        batch.projectId = projectId;
        batch.verifier = msg.sender;
        batch.ipfsHash = ipfsHash;
        batch.amount = amount;
        batch.timestamp = block.timestamp;
        batch.isRetired = false;
        batch.isFlagged = false;

        _mint(msg.sender, amount);
        batchBalances[batchId][msg.sender] = amount;
        batchSupply[batchId] = amount;
        _addBatchToUser(msg.sender, batchId);

        emit BatchMinted(batchId, projectId, msg.sender, ipfsHash, amount, block.timestamp);
        return batchId;
    }

    /**
     * @dev Keeps per-batch accounting in sync on regular transfers so credits
     * move batch-tracking to the recipient (e.g. marketplace purchases).
     * Minting and retirement manage batch state explicitly (see mintBatch and
     * _retireBatch); direct burns bypass batch accounting.
     */
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(0) || to == address(0) || from == to) return;

        uint256 remaining = value;
        uint256[] storage list = userBatches[from];
        uint256 i = 0;
        while (remaining > 0) {
            require(i < list.length, "Batch balance mismatch");
            uint256 batchId = list[i];
            uint256 bal = batchBalances[batchId][from];
            if (bal == 0) {
                // Defensive: every list entry is tracked and positive by the
                // invariants of _addBatchToUser/_removeBatchFromUser, so this
                // only runs if that invariant were ever broken.
                _removeBatchFromUser(from, batchId);
                continue;
            }
            // A flagged batch is frozen: its credits cannot change hands. This
            // keeps the compensation denominator from drifting after a
            // successful challenge, so only the holders who were exposed when
            // the batch was flagged can claim from its pool
            // (see VerifierStake.claimCompensation).
            require(!batches[batchId].isFlagged, "Batch is flagged");

            uint256 move = bal < remaining ? bal : remaining;
            batchBalances[batchId][from] = bal - move;
            _addBatchToUser(to, batchId);
            batchBalances[batchId][to] += move;
            remaining -= move;
            if (batchBalances[batchId][from] == 0) {
                _removeBatchFromUser(from, batchId);
            } else {
                i++;
            }
        }
    }

    /**
     * @notice Move credits of one *named* batch. Only the marketplace holds this
     * role. `transferFrom` has to walk the sender's batches oldest-first, which
     * means a listing could deliver a different batch from the one it named; this
     * path keeps the purchase faithful to the listing.
     */
    function transferBatchFrom(
        address from,
        address to,
        uint256 batchId,
        uint256 amount
    ) external onlyRole(BATCH_TRANSFER_ROLE) returns (bool) {
        require(to != address(0), "ERC20: transfer to the zero address");
        require(amount > 0, "Amount must be > 0");
        require(batchBalances[batchId][from] >= amount, "Insufficient batch balance");
        require(!batches[batchId].isFlagged, "Batch is flagged");

        // The role grants the ability to move a named batch, not to spend
        // without consent: the owner still has to approve the marketplace.
        uint256 allowed = allowance(from, msg.sender);
        require(allowed >= amount, "Insufficient allowance");
        _approve(from, msg.sender, allowed - amount);

        // Skip the generic oldest-first hook; this call names its batch.
        super._update(from, to, amount);

        batchBalances[batchId][from] -= amount;
        _addBatchToUser(to, batchId);
        batchBalances[batchId][to] += amount;
        if (batchBalances[batchId][from] == 0) {
            _removeBatchFromUser(from, batchId);
        }
        return true;
    }

    /**
     * @dev Retirement is the only sanctioned burn path: it updates per-batch
     * supply and mints a certificate. The inherited permissionless burn would
     * desynchronise batch accounting, so it is disabled.
     */
    function burn(uint256) public pure override {
        revert("Use retireBatch");
    }

    function burnFrom(address, uint256) public pure override {
        revert("Use retireBatchFrom");
    }

    function retireBatch(uint256 batchId, uint256 amount) external {
        _retireBatch(msg.sender, batchId, amount);
    }

    function retireBatchFrom(address from, uint256 batchId, uint256 amount) external {
        uint256 allowance = allowance(from, msg.sender);
        require(allowance >= amount, "Insufficient allowance");
        _approve(from, msg.sender, allowance - amount);
        _retireBatch(from, batchId, amount);
    }

    function _retireBatch(address from, uint256 batchId, uint256 amount) internal {
        require(batchBalances[batchId][from] >= amount, "Insufficient batch balance");
        require(!batches[batchId].isRetired, "Batch already fully retired");
        require(!batches[batchId].isFlagged, "Batch is flagged");

        _burn(from, amount);
        batchBalances[batchId][from] -= amount;
        batchSupply[batchId] -= amount;

        // Mark the batch fully retired once no circulating supply remains, so
        // getBatchInfo reports the terminal state and later splits are blocked.
        if (batchSupply[batchId] == 0) {
            batches[batchId].isRetired = true;
        }

        if (batchBalances[batchId][from] == 0) {
            _removeBatchFromUser(from, batchId);
        }

        emit BatchRetired(batchId, amount);
    }

    /**
     * @dev Fractionalizes a batch (roadmap 4): the holder moves `amount` of
     * `batchId` into a new child batch. No tokens are minted or burned, so
     * total supply is unchanged -- this only regroups ownership so credits can
     * be traded in granular lots without splitting a whole project vintage.
     *
     * The child inherits the parent's verifier and IPFS evidence, so provenance
     * is preserved; the flag check prevents laundering a disputed batch into a
     * clean-looking child.
     */
    function splitBatch(
        uint256 batchId,
        uint256 amount,
        string calldata projectId
    ) external returns (uint256 childBatchId) {
        Batch storage parent = batches[batchId];
        require(parent.batchId != 0, "Batch not found");
        require(!parent.isFlagged, "Batch is flagged");
        require(!parent.isRetired, "Batch already fully retired");
        require(amount > 0, "Amount must be > 0");
        require(bytes(projectId).length > 0, "Project ID required");
        require(batchBalances[batchId][msg.sender] >= amount, "Insufficient batch balance");

        batchBalances[batchId][msg.sender] -= amount;
        batchSupply[batchId] -= amount;
        if (batchBalances[batchId][msg.sender] == 0) {
            _removeBatchFromUser(msg.sender, batchId);
        }

        childBatchId = ++_batchIds;
        Batch storage child = batches[childBatchId];
        child.batchId = childBatchId;
        child.projectId = projectId;
        child.verifier = parent.verifier;
        child.ipfsHash = parent.ipfsHash;
        child.amount = amount;
        child.timestamp = block.timestamp;
        child.isRetired = false;
        child.isFlagged = false;

        batchParent[childBatchId] = batchId;
        batchSupply[childBatchId] = amount;
        batchBalances[childBatchId][msg.sender] = amount;
        _addBatchToUser(msg.sender, childBatchId);

        emit BatchSplit(batchId, childBatchId, msg.sender, amount);
    }

    /// @dev Record that `user` holds `batchId`. No-op when it is already listed,
    /// so callers do not need to know the holder's current batch list.
    function _addBatchToUser(address user, uint256 batchId) internal {
        if (_batchIndex[user][batchId] != 0) return;
        userBatches[user].push(batchId);
        _batchIndex[user][batchId] = userBatches[user].length; // 1-based
        activeBatchCount[user] += 1;
    }

    /// @dev Drop `batchId` from `user` in constant time (swap-and-pop with the
    /// index map), so retirement cost does not grow with the holder's history.
    function _removeBatchFromUser(address user, uint256 batchId) internal {
        uint256 idx = _batchIndex[user][batchId];
        if (idx == 0) return;
        uint256 lastIdx = userBatches[user].length;
        if (idx != lastIdx) {
            uint256 lastBatch = userBatches[user][lastIdx - 1];
            userBatches[user][idx - 1] = lastBatch;
            _batchIndex[user][lastBatch] = idx;
        }
        userBatches[user].pop();
        delete _batchIndex[user][batchId];
        activeBatchCount[user] -= 1;
    }

    function flagBatch(uint256 batchId, bool flagged) external onlyRole(DEFAULT_ADMIN_ROLE) {
        batches[batchId].isFlagged = flagged;
        emit BatchFlagged(batchId, flagged);
    }

    function getBatchInfo(uint256 batchId)
        external
        view
        returns (
            string memory projectId,
            address verifier,
            string memory ipfsHash,
            uint256 amount,
            uint256 timestamp,
            bool isRetired,
            bool isFlagged
        )
    {
        Batch storage batch = batches[batchId];
        return (
            batch.projectId,
            batch.verifier,
            batch.ipfsHash,
            batch.amount,
            batch.timestamp,
            batch.isRetired,
            batch.isFlagged
        );
    }

    function getBatchVerifier(uint256 batchId) external view returns (address) {
        return batches[batchId].verifier;
    }

    function getBatchTimestamp(uint256 batchId) external view returns (uint256) {
        return batches[batchId].timestamp;
    }

    function getBatchAmount(uint256 batchId) external view returns (uint256) {
        return batches[batchId].amount;
    }

    function getBatchProjectId(uint256 batchId) external view returns (string memory) {
        return batches[batchId].projectId;
    }

    function getUserBatchBalance(uint256 batchId, address user)
        external
        view
        returns (uint256)
    {
        return batchBalances[batchId][user];
    }

    function getTotalSupply() external view returns (uint256) {
        return totalSupply();
    }

    function getBatchSupply(uint256 batchId) external view returns (uint256) {
        return batchSupply[batchId];
    }

    function getBatchParent(uint256 batchId) external view returns (uint256) {
        return batchParent[batchId];
    }

    /**
     * @notice Point minting at an MRV oracle, or back to address(0) to disable.
     */
    function setMRVOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mrvOracle = IMRVOracle(oracle);
        emit MRVOracleUpdated(oracle);
    }

    function isBatchFlagged(uint256 batchId) external view returns (bool) {
        return batches[batchId].isFlagged;
    }

    function grantMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, account);
    }

    function grantVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(VERIFIER_ROLE, account);
    }

    function grantBatchTransferRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(BATCH_TRANSFER_ROLE, account);
    }

    function revokeMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }

    function revokeVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(VERIFIER_ROLE, account);
    }
}