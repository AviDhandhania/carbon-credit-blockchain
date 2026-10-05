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

  // Deploy RegulatorMultisig (roadmap 1).
  //
  // Deployed AFTER the original four so their addresses do not move and
  // frontend/src/utils/contracts.js keeps pointing at the right contracts.
  // OWNERS default to the first five local Hardhat accounts; override with
  // MULTISIG_OWNERS for a real panel. Deployer keeps REGULATOR_ROLE only when
  // KEEP_DEPLOYER_REGULATOR=true, so by default no single key can slash.
  const ownerEnv = process.env.MULTISIG_OWNERS || "";
  const signers = await ethers.getSigners();
  const multisigOwners = ownerEnv
    ? ownerEnv.split(",").map((a) => a.trim()).filter(Boolean)
    : signers.slice(0, 5).map((s) => s.address);
  const threshold = Number(process.env.MULTISIG_THRESHOLD || 3);

  const RegulatorMultisig = await ethers.getContractFactory("RegulatorMultisig");
  const regulatorMultisig = await RegulatorMultisig.deploy(
    multisigOwners,
    threshold,
    verifierStakeAddress
  );
  await regulatorMultisig.waitForDeployment();
  const regulatorMultisigAddress = await regulatorMultisig.getAddress();
  console.log(
    `RegulatorMultisig deployed to: ${regulatorMultisigAddress} (${threshold}-of-${multisigOwners.length})`
  );

  // Deploy the mock MRV oracle (roadmap 3). Deployed but NOT wired by default,
  // because wiring it makes every mint require an attestation.
  const MockMRVOracle = await ethers.getContractFactory("MockMRVOracle");
  const mrvOracle = await MockMRVOracle.deploy(deployer.address);
  await mrvOracle.waitForDeployment();
  const mrvOracleAddress = await mrvOracle.getAddress();
  console.log("MockMRVOracle deployed to:", mrvOracleAddress);

  // VerifierStake roles
  await verifierStake.grantVerifierRole(deployer.address);
  await verifierStake.grantRegulatorRole(deployer.address);
  await verifierStake.grantChallengerRole(deployer.address);
  console.log("VERIFIER_ROLE, REGULATOR_ROLE, CHALLENGER_ROLE granted to deployer");

  // The panel becomes the regulator. Single-key regulation is revoked unless
  // explicitly kept, which is the whole point of roadmap item 1.
  await verifierStake.grantRegulatorRole(regulatorMultisigAddress);
  console.log("REGULATOR_ROLE granted to RegulatorMultisig");
  if (process.env.KEEP_DEPLOYER_REGULATOR === "true") {
    console.log("KEEP_DEPLOYER_REGULATOR=true -> deployer keeps single-key regulator power");
  } else {
    await verifierStake.revokeRegulatorRole(deployer.address);
    console.log("REGULATOR_ROLE revoked from deployer (panel-only regulation)");
  }

  // Optionally route minting through the MRV oracle.
  if (process.env.USE_MRV_ORACLE === "true") {
    await creditToken.setMRVOracle(mrvOracleAddress);
    console.log("CreditToken MRV oracle wired to MockMRVOracle");
  } else {
    console.log("MRV oracle deployed but not wired (set USE_MRV_ORACLE=true to enable)");
  }

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
  console.log("RegulatorMultisig:", regulatorMultisigAddress);
  console.log("MockMRVOracle:", mrvOracleAddress);
  console.log("CompensationPool (losing bonds):", compensationPool);
  console.log("Multisig owners:", multisigOwners.join(", "));
  console.log("Multisig threshold:", threshold);
  console.log("Deployer:", deployer.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });