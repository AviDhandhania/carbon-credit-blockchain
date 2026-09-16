// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CreditToken.sol";

contract RetireAndCertify is ERC721URIStorage, AccessControl {
    bytes32 public constant RETIRE_ROLE = keccak256("RETIRE_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    CreditToken public immutable creditToken;

    struct Certificate {
        uint256 certificateId;
        address owner;
        uint256 batchId;
        uint256 amountRetired;
        string projectId;
        uint256 retirementTimestamp;
        string metadataURI;
    }

    uint256 private _certificateIds;
    mapping(uint256 => Certificate) public certificates;
    mapping(address => uint256[]) public userCertificates;
    mapping(uint256 => uint256) public batchTotalRetired;

    event CertificateMinted(
        uint256 indexed certificateId,
        address indexed owner,
        uint256 indexed batchId,
        uint256 amountRetired,
        string projectId
    );
    event BatchRetiredViaCertify(uint256 indexed batchId, uint256 amount, address indexed retiree);

    constructor(address _creditToken, address defaultAdmin)
        ERC721("Retirement Certificate", "RTC")
    {
        creditToken = CreditToken(_creditToken);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(RETIRE_ROLE, defaultAdmin);
        _grantRole(REGULATOR_ROLE, defaultAdmin);
    }

    function retireAndCertify(
        uint256 batchId,
        uint256 amount,
        string calldata metadataURI
    ) external onlyRole(RETIRE_ROLE) returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(bytes(metadataURI).length > 0, "Metadata URI required");
        require(creditToken.getUserBatchBalance(batchId, msg.sender) >= amount, "Insufficient batch balance");
        require(!creditToken.isBatchFlagged(batchId), "Batch is flagged");

        creditToken.retireBatchFrom(msg.sender, batchId, amount);

        uint256 certificateId = ++_certificateIds;
        string memory projectId = creditToken.getBatchProjectId(batchId);

        Certificate storage cert = certificates[certificateId];
        cert.certificateId = certificateId;
        cert.owner = msg.sender;
        cert.batchId = batchId;
        cert.amountRetired = amount;
        cert.projectId = projectId;
        cert.retirementTimestamp = block.timestamp;
        cert.metadataURI = metadataURI;

        _safeMint(msg.sender, certificateId);
        _setTokenURI(certificateId, metadataURI);

        userCertificates[msg.sender].push(certificateId);
        batchTotalRetired[batchId] += amount;

        emit CertificateMinted(certificateId, msg.sender, batchId, amount, projectId);
        emit BatchRetiredViaCertify(batchId, amount, msg.sender);

        return certificateId;
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        // Get current owner before update
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) but not transfers
        if (from != address(0) && to != address(0)) {
            revert("Certificate is soulbound: cannot transfer");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address to, uint256 tokenId) public override(ERC721, IERC721) {
        revert("Certificate is soulbound: cannot approve");
    }

    function setApprovalForAll(address operator, bool approved) public override(ERC721, IERC721) {
        revert("Certificate is soulbound: cannot set approval");
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function getCertificate(uint256 certificateId)
        external
        view
        returns (
            address owner,
            uint256 batchId,
            uint256 amountRetired,
            string memory projectId,
            uint256 retirementTimestamp,
            string memory metadataURI
        )
    {
        Certificate storage cert = certificates[certificateId];
        return (
            cert.owner,
            cert.batchId,
            cert.amountRetired,
            cert.projectId,
            cert.retirementTimestamp,
            cert.metadataURI
        );
    }

    function getUserCertificates(address user)
        external
        view
        returns (uint256[] memory)
    {
        return userCertificates[user];
    }

    function getBatchTotalRetired(uint256 batchId) external view returns (uint256) {
        return batchTotalRetired[batchId];
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function grantRetireRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(RETIRE_ROLE, account);
    }

    function grantRegulatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(REGULATOR_ROLE, account);
    }

    function revokeRetireRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(RETIRE_ROLE, account);
    }

    function revokeRegulatorRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(REGULATOR_ROLE, account);
    }
}