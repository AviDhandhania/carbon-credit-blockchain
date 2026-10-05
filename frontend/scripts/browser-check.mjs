/**
 * Browser verification of the dApp: no real MetaMask, no mocks of the app's
 * code. A minimal EIP-1193 provider backed by an ethers Wallet is injected
 * before the page loads, so the app runs its real connect path
 * (BrowserProvider -> eth_requestAccounts -> signer) against the real chain.
 *
 * What this closes: PROGRESS.md's standing "browser rendering is unverified"
 * limitation. Everything below asserts what the DOM actually paints.
 *
 * Usage (fresh chain):
 *   npx hardhat node
 *   npx hardhat run scripts/deploy.js --network localhost
 *   cd frontend && npm run dev
 *   node scripts/browser-check.mjs
 */
import puppeteer from 'puppeteer-core';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../src/utils/contracts.js';

const APP = process.env.APP_URL || 'http://localhost:3000';
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const KEY =
  process.env.BROWSER_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
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
  throw new Error('Chrome not found; set CHROME_PATH');
}

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${String(err.message || err).split('\n')[0]}`);
    failed++;
    failures.push(name);
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const address = await wallet.getAddress();

  // Seed one batch so the UI has data to paint. On a fresh chain the deployer
  // holds MINTER_ROLE, and the MRV oracle is unwired by default.
  const token = new ethers.Contract(
    CONTRACT_ADDRESSES.CreditToken,
    CONTRACT_ABIS.CreditToken,
    wallet
  );
  const supplyNow = await token.totalSupply();
  if (supplyNow === 0n) {
    await (await token.mintBatch('PROJ-UI', 'QmUIHash', ethers.parseUnits('1000', 18))).wait();
    console.log('Seeded: minted 1000 CC (batch 1)');
  }

  const chrome = await findChrome();
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push('console.error: ' + m.text());
  });

  // Inject a minimal EIP-1193 provider before any app script runs.
  await page.evaluateOnNewDocument((rpc, acct) => {
    let chainId = '0x7a69';
    const listeners = {};
    window.ethereum = {
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct];
        if (method === 'eth_chainId') return chainId;
        return rpcRequest(method, params);
      },
      on: (evt, cb) => { (listeners[evt] ||= []).push(cb); },
      removeListener: (evt, cb) => {
        listeners[evt] = (listeners[evt] || []).filter((f) => f !== cb);
      },
      removeAllListeners: () => { Object.keys(listeners).forEach((k) => delete listeners[k]); },
    };
    async function rpcRequest(method, params) {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || [] }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      return json.result;
    }
  }, RPC, address);

  console.log(`\nLoading ${APP} ...`);
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 60000 });

  console.log('\n== Shell & connect ==');
  await check('app title renders', async () => {
    const title = await page.$eval('h1', (el) => el.textContent);
    if (!title.includes('Carbon Credit Trading System')) throw new Error(`got: ${title}`);
  });
  await check('Connect MetaMask button is present', async () => {
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((x) => /connect metamask/i.test(x.textContent))
    );
    if (!found) throw new Error('no connect button');
  });
  await check('connect succeeds through the real app path', async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /connect metamask/i.test(x.textContent));
      b.click();
    });
    await page.waitForFunction(
      () => document.body.innerText.includes('Connected:'),
      { timeout: 15000 }
    );
    const badge = await page.evaluate(() => document.body.innerText.includes('Localhost (Hardhat)'));
    if (!badge) throw new Error('network badge not shown');
  });

  console.log('\n== Panel presence (all six modules) ==');
  const headings = [
    'Credit Token (ERC-20)',
    'Marketplace',
    'Retire & Certify',
    'Verifier Stake & Challenge',
    'Regulator Multisig (3-of-5)',
  ];
  for (const h of headings) {
    await check(`panel renders: ${h}`, async () => {
      const found = await page.evaluate((needle) => {
        return [...document.querySelectorAll('h2')].some((x) => x.textContent.includes(needle));
      }, h);
      if (!found) throw new Error(`h2 "${h}" not in DOM`);
    });
  }

  console.log('\n== Live data binding (real chain -> real DOM) ==');
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('strong')].find((x) => x.textContent.includes('Total Supply'));
    return el && el.parentElement.textContent.trim() !== 'Total Supply: 0 CC';
  }, { timeout: 20000 }).catch(() => {});
  await check('Total Supply paints a non-zero value from the chain', async () => {
    const txt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('strong')].find((x) => x.textContent.includes('Total Supply'));
      return el ? el.parentElement.textContent.trim() : '(missing)';
    });
    const m = txt.match(/([\d.,]+)\s*CC/);
    if (!m || parseFloat(m[1].replace(/,/g, '')) <= 0) throw new Error(`got: ${txt}`);
  });
  await check('Regulator panel shows the deployed 3-of-5 threshold', async () => {
    // All five panels load on mount now, so wait for the multisig data rather
    // than snapshotting an instant that depends on RPC scheduling.
    await page.waitForFunction(
      () => /Threshold:\s*3-of-5/.test(document.body.innerText),
      { timeout: 20000 }
    );
  });
  await check('Regulator panel lists five owner addresses', async () => {
    await page.waitForFunction(
      () => {
        const h = [...document.querySelectorAll('h2')].find((x) =>
          x.textContent.includes('Regulator Multisig')
        );
        if (!h) return false;
        const card = h.closest('.card');
        return card ? card.querySelectorAll('li').length === 5 : false;
      },
      { timeout: 20000 }
    );
  });
  await check('wallet address is the injected account', async () => {
    const shown = await page.evaluate(() => document.body.innerText);
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    if (!shown.includes(short)) throw new Error(`expected ${short} in header`);
  });

  console.log('\n== No runtime errors ==');
  const relevant = pageErrors.filter(
    (e) => !/favicon/i.test(e) && !/net::ERR/i.test(e) && !/Failed to load resource/i.test(e)
  );
  await check('no page errors or console.error during load', () => {
    if (relevant.length) throw new Error(relevant.join(' | '));
  });

  console.log('\n== Screenshot ==');
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser-check.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log(`  saved ${out}`);

  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
