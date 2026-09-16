// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CreditToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

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
        userBatches[msg.sender].push(batchId);

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
                list[i] = list[list.length - 1];
                list.pop();
                continue;
            }
            uint256 move = bal < remaining ? bal : remaining;
            batchBalances[batchId][from] = bal - move;
            if (batchBalances[batchId][to] == 0) {
                userBatches[to].push(batchId);
            }
            batchBalances[batchId][to] += move;
            remaining -= move;
            i++;
        }
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

        if (batchBalances[batchId][from] == 0) {
            uint256[] storage userBatchList = userBatches[from];
            for (uint256 i = 0; i < userBatchList.length; i++) {
                if (userBatchList[i] == batchId) {
                    userBatchList[i] = userBatchList[userBatchList.length - 1];
                    userBatchList.pop();
                    break;
                }
            }
        }

        uint256 totalRemaining = 0;
        for (uint256 i = 0; i < userBatches[from].length; i++) {
            totalRemaining += batchBalances[userBatches[from][i]][from];
        }
        if (totalRemaining == 0) {
            delete userBatches[from];
        }

        emit BatchRetired(batchId, amount);
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

    function isBatchFlagged(uint256 batchId) external view returns (bool) {
        return batches[batchId].isFlagged;
    }

    function grantMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, account);
    }

    function grantVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(VERIFIER_ROLE, account);
    }

    function revokeMinterRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, account);
    }

    function revokeVerifierRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(VERIFIER_ROLE, account);
    }
}