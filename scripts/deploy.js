async function main() {
  const [deployer] = await ethers.getSigners();
  // Slashed funds sent here must be withdrawable, so it cannot be another
  // protocol contract (e.g. RetireAndCertify has no withdraw function).
  const compensationPool = process.env.COMPENSATION_POOL || deployer.address;
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // Deploy CreditToken
  const CreditToken = await ethers.getContractFactory("CreditToken");
  const creditToken = await CreditToken.deploy(deployer.address);
  await creditToken.waitForDeployment();
  const creditTokenAddress = await creditToken.getAddress();
  console.log("CreditToken deployed to:", creditTokenAddress);

  // Deploy Marketplace
  const Marketplace = await ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy(creditTokenAddress, deployer.address);
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log("Marketplace deployed to:", marketplaceAddress);

  // Deploy RetireAndCertify
  const RetireAndCertify = await ethers.getContractFactory("RetireAndCertify");
  const retireAndCertify = await RetireAndCertify.deploy(creditTokenAddress, deployer.address);
  await retireAndCertify.waitForDeployment();
  const retireAndCertifyAddress = await retireAndCertify.getAddress();
  console.log("RetireAndCertify deployed to:", retireAndCertifyAddress);

  // Deploy VerifierStake
  const VerifierStake = await ethers.getContractFactory("VerifierStake");
  const verifierStake = await VerifierStake.deploy(creditTokenAddress, compensationPool, deployer.address);
  await verifierStake.waitForDeployment();
  const verifierStakeAddress = await verifierStake.getAddress();
  console.log("VerifierStake deployed to:", verifierStakeAddress);

  // Grant roles
  console.log("\nGranting roles...");

  // CreditToken roles
  await creditToken.grantMinterRole(deployer.address);
  console.log("MINTER_ROLE granted to deployer");

  // Marketplace roles
  await marketplace.grantBuyerRole(deployer.address);
  console.log("BUYER_ROLE granted to deployer");

  // RetireAndCertify roles
  await retireAndCertify.grantRetireRole(deployer.address);
  console.log("RETIRE_ROLE granted to deployer");

  // VerifierStake roles
  await verifierStake.grantVerifierRole(deployer.address);
  await verifierStake.grantRegulatorRole(deployer.address);
  await verifierStake.grantChallengerRole(deployer.address);
  console.log("VERIFIER_ROLE, REGULATOR_ROLE, CHALLENGER_ROLE granted to deployer");

  // Grant VerifierStake admin role on CreditToken for flagging
  await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), verifierStakeAddress);
  console.log("DEFAULT_ADMIN_ROLE on CreditToken granted to VerifierStake");

  // Grant RetireAndCertify admin role on CreditToken for retirement
  await creditToken.grantRole(await creditToken.DEFAULT_ADMIN_ROLE(), retireAndCertifyAddress);
  console.log("DEFAULT_ADMIN_ROLE on CreditToken granted to RetireAndCertify");

  console.log("\n=== Deployment Summary ===");
  console.log("CreditToken:", creditTokenAddress);
  console.log("Marketplace:", marketplaceAddress);
  console.log("RetireAndCertify:", retireAndCertifyAddress);
  console.log("VerifierStake:", verifierStakeAddress);
  console.log("CompensationPool:", compensationPool);
  console.log("Deployer:", deployer.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });