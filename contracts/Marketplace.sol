// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CreditToken.sol";

contract Marketplace is AccessControl, ReentrancyGuard {
    bytes32 public constant MARKETPLACE_ADMIN_ROLE = keccak256("MARKETPLACE_ADMIN_ROLE");
    bytes32 public constant BUYER_ROLE = keccak256("BUYER_ROLE");

    CreditToken public immutable creditToken;

    struct Listing {
        uint256 listingId;
        uint256 batchId;
        address seller;
        uint256 amount;
        uint256 pricePerToken;
        bool isActive;
        uint256 createdAt;
    }

    uint256 public listingCount;
    mapping(uint256 => Listing) public listings;
    mapping(address => uint256[]) public userListings;
    mapping(uint256 => mapping(address => uint256)) public listingPurchases;

    event ListingCreated(
        uint256 indexed listingId,
        uint256 indexed batchId,
        address indexed seller,
        uint256 amount,
        uint256 pricePerToken
    );
    event ListingCancelled(uint256 indexed listingId);
    event TokensPurchased(
        uint256 indexed listingId,
        uint256 indexed batchId,
        address indexed buyer,
        address seller,
        uint256 amount,
        uint256 totalPrice
    );
    event ListingUpdated(uint256 indexed listingId, uint256 newPrice);

    constructor(address _creditToken, address defaultAdmin) {
        creditToken = CreditToken(_creditToken);
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MARKETPLACE_ADMIN_ROLE, defaultAdmin);
        _grantRole(BUYER_ROLE, defaultAdmin);
    }

    function createListing(
        uint256 batchId,
        uint256 amount,
        uint256 pricePerToken
    ) external onlyRole(BUYER_ROLE) nonReentrant returns (uint256) {
        require(amount > 0, "Amount must be > 0");
        require(pricePerToken > 0, "Price must be > 0");
        require(creditToken.getUserBatchBalance(batchId, msg.sender) >= amount, "Insufficient batch balance");
        require(!creditToken.isBatchFlagged(batchId), "Batch is flagged");

        uint256 listingId = ++listingCount;
        Listing storage listing = listings[listingId];
        listing.listingId = listingId;
        listing.batchId = batchId;
        listing.seller = msg.sender;
        listing.amount = amount;
        listing.pricePerToken = pricePerToken;
        listing.isActive = true;
        listing.createdAt = block.timestamp;

        userListings[msg.sender].push(listingId);

        emit ListingCreated(listingId, batchId, msg.sender, amount, pricePerToken);
        return listingId;
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Only seller can cancel");
        require(listing.isActive, "Listing not active");

        listing.isActive = false;

        emit ListingCancelled(listingId);
    }

    function updateListingPrice(uint256 listingId, uint256 newPrice) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Only seller can update price");
        require(listing.isActive, "Listing not active");
        require(newPrice > 0, "Price must be > 0");

        listing.pricePerToken = newPrice;

        emit ListingUpdated(listingId, newPrice);
    }

    function buyTokens(uint256 listingId, uint256 amount) external payable nonReentrant returns (uint256) {
        Listing storage listing = listings[listingId];
        require(listing.isActive, "Listing not active");
        require(amount > 0 && amount <= listing.amount, "Invalid amount");
        require(!creditToken.isBatchFlagged(listing.batchId), "Batch is flagged");

        // amount is in 18-decimal base units; pricePerToken is per whole credit
        uint256 totalPrice = (amount * listing.pricePerToken) / 1e18;
        require(totalPrice > 0, "Insufficient payment");
        require(msg.value >= totalPrice, "Insufficient payment");

        listing.amount -= amount;
        listingPurchases[listingId][msg.sender] += amount;

        creditToken.transferFrom(listing.seller, msg.sender, amount);

        if (msg.value > totalPrice) {
            payable(msg.sender).transfer(msg.value - totalPrice);
        }
        payable(listing.seller).transfer(totalPrice);

        if (listing.amount == 0) {
            listing.isActive = false;
        }

        emit TokensPurchased(listingId, listing.batchId, msg.sender, listing.seller, amount, totalPrice);
        return totalPrice;
    }

    function getListing(uint256 listingId)
        external
        view
        returns (
            uint256 batchId,
            address seller,
            uint256 amount,
            uint256 pricePerToken,
            bool isActive,
            uint256 createdAt
        )
    {
        Listing storage listing = listings[listingId];
        return (
            listing.batchId,
            listing.seller,
            listing.amount,
            listing.pricePerToken,
            listing.isActive,
            listing.createdAt
        );
    }

    function getActiveListings()
        external
        view
        returns (uint256[] memory)
    {
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= listingCount; i++) {
            if (listings[i].isActive) activeCount++;
        }

        uint256[] memory activeListings = new uint256[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= listingCount; i++) {
            if (listings[i].isActive) {
                activeListings[idx] = i;
                idx++;
            }
        }
        return activeListings;
    }

    function getUserListings(address user)
        external
        view
        returns (uint256[] memory)
    {
        return userListings[user];
    }

    function getUserPurchases(uint256 listingId, address user)
        external
        view
        returns (uint256)
    {
        return listingPurchases[listingId][user];
    }

    function grantBuyerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(BUYER_ROLE, account);
    }

    function revokeBuyerRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(BUYER_ROLE, account);
    }

    function grantMarketplaceAdminRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MARKETPLACE_ADMIN_ROLE, account);
    }

    function withdrawEth() external onlyRole(MARKETPLACE_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }
}