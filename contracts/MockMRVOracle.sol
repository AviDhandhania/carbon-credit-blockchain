// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IMRVOracle.sol";

/**
 * @title MockMRVOracle
 * @notice A settable stand-in for a real MRV feed.
 *
 * A production deployment would sit behind an adapter that pulls from satellite
 * imagery, soil sensors or a registry API. This mock exposes the same interface
 * with admin-set values so CreditToken's attestation path can be tested and
 * demonstrated without an off-chain dependency.
 */
contract MockMRVOracle is IMRVOracle, AccessControl {
    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ORACLE_ADMIN_ROLE");

    mapping(string => bytes32) private _hashes;
    mapping(string => bool) private _approved;
    mapping(string => uint256) private _tonnage;

    event ProjectAttested(
        string indexed projectId,
        bytes32 evidenceHash,
        uint256 tonnage,
        bool approved
    );

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ADMIN_ROLE, admin);
    }

    /// @notice Attest (or revoke) a project's reported data.
    function attestProject(
        string calldata projectId,
        bytes32 evidenceHash,
        uint256 tonnage,
        bool approved
    ) external onlyRole(ORACLE_ADMIN_ROLE) {
        require(bytes(projectId).length > 0, "Project ID required");
        _hashes[projectId] = evidenceHash;
        _tonnage[projectId] = tonnage;
        _approved[projectId] = approved;
        emit ProjectAttested(projectId, evidenceHash, tonnage, approved);
    }

    /// @notice Convenience overload hashing a plain evidence string.
    function attestProjectWithString(
        string calldata projectId,
        string calldata ipfsHash,
        uint256 tonnage,
        bool approved
    ) external onlyRole(ORACLE_ADMIN_ROLE) {
        require(bytes(projectId).length > 0, "Project ID required");
        _hashes[projectId] = keccak256(bytes(ipfsHash));
        _tonnage[projectId] = tonnage;
        _approved[projectId] = approved;
        emit ProjectAttested(projectId, keccak256(bytes(ipfsHash)), tonnage, approved);
    }

    function getProjectHash(string calldata projectId) external view returns (bytes32) {
        return _hashes[projectId];
    }

    function isProjectApproved(string calldata projectId) external view returns (bool) {
        return _approved[projectId];
    }

    function getVerifiedTonnage(string calldata projectId) external view returns (uint256) {
        return _tonnage[projectId];
    }
}
