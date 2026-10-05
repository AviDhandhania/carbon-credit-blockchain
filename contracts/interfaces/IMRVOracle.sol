// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMRVOracle
 * @notice Minimal measurement/reporting/verification (MRV) oracle surface.
 *
 * DA1 §2 identified "garbage in" as the core weakness of on-chain carbon
 * markets: a ledger can prove a credit was not double-spent, but not that the
 * tonnes behind it exist. This interface lets an off-chain MRV feed (satellite
 * imagery, soil sensors, registry API) attest to project data so minting can
 * require it.
 *
 * Implementations are deliberately trivial to mock: the on-chain contract only
 * needs the attestation, not the measurement itself.
 */
interface IMRVOracle {
    /// @notice keccak256 fingerprint of the evidence the oracle holds for a project.
    function getProjectHash(string calldata projectId) external view returns (bytes32);

    /// @notice True when the oracle has attested that the project data is valid.
    function isProjectApproved(string calldata projectId) external view returns (bool);

    /// @notice Tonnes of CO2e the oracle attests to for a project.
    function getVerifiedTonnage(string calldata projectId) external view returns (uint256);
}
