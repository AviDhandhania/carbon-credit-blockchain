import puppeteer from 'puppeteer-core';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = process.env.APP_URL || 'http://localhost:3000';
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const KEY =
  process.env.BROWSER_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Account 0 (deployer)

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome not found');
}

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ok: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ FAIL: ${name}\n     ${String(err.message || err).split('\n')[0]}`);
    failed++;
  }
}

async function fill(page, selector, val) {
  await page.waitForSelector(selector);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Not found: ${sel}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, val);
}

async function run() {
  console.log('--- Starting Comprehensive Browser E2E Test Suite ---');
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const address = await wallet.getAddress();
  console.log(`Testing with account: ${address}`);

  const chrome = await findChrome();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1800 });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const txt = m.text();
      if (!txt.includes('favicon') && !txt.includes('ERR_CONNECTION')) {
        pageErrors.push(txt);
      }
    }
  });

  // Inject EIP-1193 Provider that interacts directly with our local chain
  await page.evaluateOnNewDocument((rpc, acct) => {
    let chainId = '0x7a69'; // 31337
    const listeners = {};

    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          return [acct];
        }
        if (method === 'eth_chainId') return chainId;
        if (method === 'wallet_switchEthereumChain') {
          chainId = params[0].chainId;
          if (listeners['chainChanged']) listeners['chainChanged'].forEach((cb) => cb(chainId));
          return null;
        }

        const res = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || [] }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        return json.result;
      },
      on: (evt, cb) => { (listeners[evt] ||= []).push(cb); },
      removeListener: (evt, cb) => {
        listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb);
      },
      removeAllListeners: () => {
        Object.keys(listeners).forEach((k) => delete listeners[k]);
      },
    };
  }, RPC, address);

  console.log(`Loading application at ${APP}...`);
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 30000 });

  // 1. Connect Wallet
  await check('Wallet connection via MetaMask button', async () => {
    const connectBtn = await page.waitForSelector('button.btn-primary');
    await connectBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes('Connected:'),
      { timeout: 10000 }
    );
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('Localhost (Hardhat)')) throw new Error('Network not detected as Localhost');
  });

  // 2. Mint Batch
  let activeBatchId = null;
  const projectName = `PROJ-E2E-${Date.now().toString().slice(-4)}`;
  await check(`Mint Batch (${projectName}) through Credit Token UI form`, async () => {
    await fill(page, 'input[placeholder="PROJ-001"]', projectName);
    await fill(page, 'input[placeholder="QmHash123..."]', 'QmSolarEvidenceHash999');
    await fill(page, 'input[placeholder="1000"]', '1000');

    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Mint Batch'));
      return b && !b.disabled;
    });

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Mint Batch'));
      btn.click();
    });

    await page.waitForFunction(
      (pName) => document.body.innerText.includes(pName),
      { timeout: 15000 },
      projectName
    );

    activeBatchId = await page.evaluate((pName) => {
      const rows = [...document.querySelectorAll('table tbody tr')];
      const targetRow = rows.find((r) => r.innerText.includes(pName));
      return targetRow ? targetRow.querySelectorAll('td')[0].innerText.trim() : null;
    }, projectName);

    if (!activeBatchId) throw new Error('Could not identify minted batch ID from UI table');
    console.log(`      -> Discovered Minted Batch ID: ${activeBatchId}`);
  });

  // 3. Split Batch
  await check('Fractionalize / Split Batch into child lot through UI form', async () => {
    await page.evaluate((batchId) => {
      const childInput = document.querySelector('input[placeholder="PROJ-001-A"]');
      const form = childInput.closest('form');
      const inputs = form.querySelectorAll('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

      setter.call(inputs[0], String(batchId));
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[1], '100');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[2], 'PROJ-E2E-CHILD');
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));

      const splitBtn = form.querySelector('button[type="submit"]');
      splitBtn.click();
    }, activeBatchId);

    // Wait for the button to reset from "Splitting..."
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Split Batch'));
        return btn && !btn.disabled && !btn.innerText.includes('Splitting');
      },
      { timeout: 15000 }
    );
  });

  // 4. Create Marketplace Listing
  await check('Create Carbon Credit Listing in Marketplace', async () => {
    await page.evaluate((batchId) => {
      const form = [...document.querySelectorAll('form')].find((f) =>
        f.innerText.includes('Price per CC')
      );
      if (!form) throw new Error('Create listing form not found');
      const inputs = form.querySelectorAll('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

      setter.call(inputs[0], String(batchId));
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[1], '50');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[2], '0.005');
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));

      const submit = form.querySelector('button[type="submit"]');
      submit.click();
    }, activeBatchId);

    // Wait for listing to show in the table and select
    await page.waitForFunction(
      () => {
        const select = document.querySelector('select');
        return select && select.options.length > 1;
      },
      { timeout: 25000 }
    );
  });

  // 5. Buy Credits from Listing
  await check('Buy Carbon Credits from Marketplace Listing', async () => {
    await page.evaluate(() => {
      const select = document.querySelector('select');
      if (!select || select.options.length <= 1) throw new Error('No listings in select');
      select.selectedIndex = 1;
      select.dispatchEvent(new Event('change', { bubbles: true }));

      const form = select.closest('form');
      const input = form.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '5');
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const submit = form.querySelector('button[type="submit"]');
      submit.click();
    });

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('select')?.closest('form')?.querySelector('button[type="submit"]');
        return btn && !btn.disabled && !btn.innerText.includes('Buying');
      },
      { timeout: 25000 }
    );
  });

  // 6. Retire Credits & Mint Soulbound Certificate
  await check('Retire credits and mint Soulbound NFT certificate', async () => {
    await page.evaluate((batchId) => {
      const form = document.querySelector('input[placeholder="ipfs://QmCertificateHash"]').closest('form');
      const inputs = form.querySelectorAll('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

      setter.call(inputs[0], String(batchId));
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[1], '10');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(inputs[2], 'ipfs://QmCertificateSoulboundNFT');
      inputs[2].dispatchEvent(new Event('input', { bubbles: true }));

      const submit = form.querySelector('button[type="submit"]');
      submit.click();
    }, activeBatchId);

    await page.waitForFunction(
      () => document.body.innerHTML.includes('QmCertificateSoulboundNFT'),
      { timeout: 25000 }
    );
  });

  // 7. Deposit Verifier Stake
  await check('Deposit Verifier Stake in VerifierStake contract', async () => {
    await page.evaluate(() => {
      const form = [...document.querySelectorAll('form')].find((f) =>
        f.innerText.includes('Deposit Stake')
      );
      if (!form) throw new Error('Deposit stake form not found');
      const input = form.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

      setter.call(input, '1.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const submit = form.querySelector('button[type="submit"]');
      submit.click();
    });

    await page.waitForFunction(
      () => {
        const strongs = [...document.querySelectorAll('strong')];
        const s = strongs.find((el) => el.innerText.includes('Your Stake:'));
        return s && s.parentElement && !s.parentElement.innerText.includes('0 ETH');
      },
      { timeout: 20000 }
    );
  });

  // 8. Verify Panels State & Multisig
  await check('Regulator Multisig 3-of-5 threshold and status inspection', async () => {
    const text = await page.evaluate(() => document.body.innerText);
    if (!text.includes('Regulator Multisig (3-of-5)')) throw new Error('Multisig heading missing');
    if (!text.includes('Threshold: 3-of-5')) throw new Error('Threshold missing');
    if (!text.includes('Active')) throw new Error('Active verifier status missing');
  });

  // Take full page screenshot
  const screenshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'e2e-run.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  const bannerErrors = await page.evaluate(() => [...document.querySelectorAll('.status.error')].map(e => e.innerText)); console.log('On-page error banners:', bannerErrors); await browser.close();

  console.log(`\n========================================`);
  console.log(`E2E Browser Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);

  if (pageErrors.length > 0) {
    console.log('Page errors captured:', JSON.stringify(pageErrors, null, 2));
  }

  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('Fatal Test Run Error:', e);
  process.exit(1);
});
