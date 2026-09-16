// Contract addresses - update these after deployment
export const CONTRACT_ADDRESSES = {
  // Addresses from a fresh `npx hardhat node` + `npm run deploy:local` run.
  // Redeploying on a node that already has history shifts these (deployer nonce).
  CreditToken: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  Marketplace: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  RetireAndCertify: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  VerifierStake: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
};

// Contract ABIs
export const CONTRACT_ABIS = {
  CreditToken: [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function mintBatch(string projectId, string ipfsHash, uint256 amount) returns (uint256)",
    "function retireBatch(uint256 batchId, uint256 amount)",
    "function retireBatchFrom(address from, uint256 batchId, uint256 amount)",
    "function flagBatch(uint256 batchId, bool flagged)",
    "function getBatchInfo(uint256 batchId) view returns (string, address, string, uint256, uint256, bool, bool)",
    "function getBatchVerifier(uint256 batchId) view returns (address)",
    "function getBatchTimestamp(uint256 batchId) view returns (uint256)",
    "function getBatchProjectId(uint256 batchId) view returns (string)",
    "function getUserBatchBalance(uint256 batchId, address user) view returns (uint256)",
    "function isBatchFlagged(uint256 batchId) view returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function grantMinterRole(address account)",
    "function grantVerifierRole(address account)",
    "event BatchMinted(uint256 indexed batchId, string projectId, address indexed verifier, string ipfsHash, uint256 amount, uint256 timestamp)",
    "event BatchRetired(uint256 indexed batchId, uint256 amount)",
    "event BatchFlagged(uint256 indexed batchId, bool flagged)",
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  ],
  Marketplace: [
    "function createListing(uint256 batchId, uint256 amount, uint256 pricePerToken) returns (uint256)",
    "function cancelListing(uint256 listingId)",
    "function updateListingPrice(uint256 listingId, uint256 newPrice)",
    "function buyTokens(uint256 listingId, uint256 amount) payable returns (uint256)",
    "function getListing(uint256 listingId) view returns (uint256, address, uint256, uint256, bool, uint256)",
    "function getActiveListings() view returns (uint256[])",
    "function getUserListings(address user) view returns (uint256[])",
    "function listingCount() view returns (uint256)",
    "event ListingCreated(uint256 indexed listingId, uint256 indexed batchId, address indexed seller, uint256 amount, uint256 pricePerToken)",
    "event ListingCancelled(uint256 indexed listingId)",
    "event TokensPurchased(uint256 indexed listingId, uint256 indexed batchId, address indexed buyer, address seller, uint256 amount, uint256 totalPrice)"
  ],
  RetireAndCertify: [
    "function retireAndCertify(uint256 batchId, uint256 amount, string metadataURI) returns (uint256)",
    "function getCertificate(uint256 certificateId) view returns (address, uint256, uint256, string, uint256, string)",
    "function getUserCertificates(address user) view returns (uint256[])",
    "function getBatchTotalRetired(uint256 batchId) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)",
    "function tokenURI(uint256) view returns (string)",
    "event CertificateMinted(uint256 indexed certificateId, address indexed owner, uint256 indexed batchId, uint256 amountRetired, string projectId)"
  ],
  VerifierStake: [
    "function depositStake() payable",
    "function withdrawStake(uint256 amount)",
    "function createChallenge(uint256 batchId, string evidenceHash) payable",
    "function resolveChallenge(uint256 challengeId, bool challengerWins)",
    "function getVerifierInfo(address verifier) view returns (uint256, uint256, bool)",
    "function getChallenge(uint256 challengeId) view returns (uint256, address, string, uint256, uint256, bool, bool)",
    "function getBatchChallenges(uint256 batchId) view returns (uint256[])",
    "function challengeCount() view returns (uint256)",
    "event StakeDeposited(address indexed verifier, uint256 amount)",
    "event ChallengeCreated(uint256 indexed challengeId, uint256 indexed batchId, address indexed challenger, string evidenceHash)",
    "event ChallengeResolved(uint256 indexed challengeId, bool challengerWon, uint256 slashedAmount, address indexed recipient)"
  ]
};