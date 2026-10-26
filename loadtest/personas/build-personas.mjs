/**
 * Phase 4.1 — persona library builder.
 *
 * Two modes:
 *
 *   node loadtest/personas/build-personas.mjs --validate [file]
 *       Checks a library against persona-library.schema.json. Needs no API key.
 *       Defaults to persona-library.example.json.
 *
 *   node loadtest/personas/build-personas.mjs --count 12
 *       Generates personas with an OpenAI-compatible LLM and writes
 *       loadtest/personas/persona-library.json.
 *       Requires: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_NAME in the environment
 *       (or in ./.env). This is the phase that MiroFish's
 *       oasis_profile_generator would otherwise perform; the field set below is
 *       deliberately the same, so MiroFish output can be dropped in verbatim.
 *
 * Exit codes: 0 = ok, 1 = invalid input/output, 2 = missing configuration.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, 'persona-library.schema.json'), 'utf8'));
const SCHEMA_JOURNEYS = SCHEMA.properties.personas.items.properties.journeys.items.enum;
const SCHEMA_ROLES = SCHEMA.properties.personas.items.properties.role.enum;

const ROLES = {
  developer: 'mints and fractionalizes batches, owns project evidence',
  verifier: 'stakes ETH, approves batches, files challenges inside the window',
  buyer: 'buys, lists, retires credits and claims compensation',
  regulator: 'acts for the 3-of-5 panel that resolves challenges',
};

const JOURNEYS = {
  'developer-mint-split': 'mint a batch, then fractionalize part of it into a child batch',
  'verifier-stake-challenge-window': 'stake, then challenge a batch with IPFS evidence',
  'buyer-list-buy-retire-certify': 'buy credits, list some, buy more, retire into a certificate',
  'compensation-claim-after-slash': 'claim a pro-rata share of a slashed verifier pool',
  'regulator-3of5-resolution': 'propose a resolution and gather three approvals',
  'negative-permissions': 'attempt actions the account has no role for',
  'negative-boundaries': 'attempt zero/over-limit amounts and out-of-window actions',
  'race-two-buyers-one-listing': 'buy a listing concurrently with another buyer',
};

// --- validation -------------------------------------------------------------
function validate(lib) {
  const errs = [];
  const push = (m) => errs.push(m);
  if (lib.version !== 1) push(`version must be 1 (got ${lib.version})`);
  if (!Array.isArray(lib.personas) || lib.personas.length === 0) push('personas must be a non-empty array');
  const seen = new Set();
  for (const [i, p] of (lib.personas || []).entries()) {
    const at = `personas[${i}]${p && p.id ? ` (${p.id})` : ''}`;
    for (const f of SCHEMA.properties.personas.items.required) {
      if (p[f] === undefined) push(`${at}: missing required "${f}"`);
    }
    if (p.id && !/^[a-z0-9-]+$/.test(p.id)) push(`${at}: id must be kebab-case`);
    if (p.id) {
      if (seen.has(p.id)) push(`${at}: duplicate id`);
      seen.add(p.id);
    }
    if (p.role && !SCHEMA_ROLES.includes(p.role)) push(`${at}: role "${p.role}" not in ${SCHEMA_ROLES.join('|')}`);
    for (const j of p.journeys || []) {
      if (!SCHEMA_JOURNEYS.includes(j)) push(`${at}: journey "${j}" not in the schema enum`);
    }
    if (p.age !== undefined && (p.age < 18 || p.age > 90)) push(`${at}: age out of range`);
    if (p.behaviour) {
      const b = p.behaviour;
      if (b.riskTolerance !== undefined && (b.riskTolerance < 0 || b.riskTolerance > 1)) push(`${at}: riskTolerance must be 0..1`);
      if (b.retries !== undefined && (b.retries < 0 || b.retries > 5)) push(`${at}: retries must be 0..5`);
    }
  }
  // every journey should be covered by at least one persona, otherwise a whole
  // behaviour class silently never runs
  const covered = new Set((lib.personas || []).flatMap((p) => p.journeys || []));
  for (const j of SCHEMA_JOURNEYS) if (!covered.has(j)) push(`no persona covers journey "${j}"`);
  return errs;
}

// --- generation -------------------------------------------------------------
function loadDotEnv() {
  const envPath = join(HERE, '..', '..', '.env');
  if (!existsSync(envPath)) return {};
  const out = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function buildPrompt(count) {
  return `You are generating realistic human personas for a load/behaviour test of a blockchain
carbon-credit trading dApp. Each persona becomes one simulated user with its own wallet.

Return ONLY a JSON array of ${count} objects, no prose, no markdown fence. Each object has exactly:
  name (string), bio (string, 1-3 sentences, concrete and specific), age (int 18-90),
  gender (string), mbti (string, 4 letters), country (string), profession (string),
  interested_topics (array of 2-4 short strings),
  role (one of: ${SCHEMA_ROLES.join(', ')}),
  journeys (array of 1-3 from: ${SCHEMA_JOURNEYS.join(', ')}),
  behaviour ({ riskTolerance: 0-1, maxTx: 1-20, maxEth: 0-5, retries: 0-5, abortOnError: bool })

Roles available:
${Object.entries(ROLES).map(([r, d]) => `  - ${r}: ${d}`).join('\n')}

Journeys available:
${Object.entries(JOURNEYS).map(([j, d]) => `  - ${j}: ${d}`).join('\n')}

Make the population diverse in motive and competence: a meticulous auditor, a trader probing
limits, a first-time buyer who gives up when a transaction fails, an impatient developer.
Cover every journey at least once across the population.`;
}

/**
 * Google's Generative Language host only speaks the OpenAI wire shape under the
 * `/v1beta/openai` prefix; the bare host 404s. Accept either spelling so
 * LLM_BASE_URL=https://generativelanguage.googleapis.com works as-is.
 */
function normaliseBaseUrl(base) {
  const b = String(base || 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (/^https?:\/\/generativelanguage\.googleapis\.com$/i.test(b)) return `${b}/v1beta/openai`;
  return b;
}

async function generate(count) {
  const dotenv = loadDotEnv();
  const key = process.env.LLM_API_KEY || dotenv.LLM_API_KEY;
  const base = normaliseBaseUrl(process.env.LLM_BASE_URL || dotenv.LLM_BASE_URL);
  const model = process.env.LLM_MODEL_NAME || dotenv.LLM_MODEL_NAME || 'gpt-4o-mini';
  if (!key) {
    console.error('MISSING CONFIG: no LLM_API_KEY in the environment or ./.env');
    console.error('Phase 4.1 cannot run without an OpenAI-compatible key. See docs/LoadTest_Report.md §6.');
    process.exitCode = 2;
    return;
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: buildPrompt(count) },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`LLM call failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content ?? '';
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  let personas;
  try {
    personas = JSON.parse(json);
  } catch (e) {
    console.error('Could not parse the model output as JSON:', String(e.message));
    process.exitCode = 1;
    return;
  }
  personas = personas.map((p, i) => ({
    id: `${(p.role || 'user').slice(0, 3)}-${String(p.name || `p${i}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    ...p,
  }));

  const lib = { version: 1, generatedBy: 'llm', model, personas };
  const errs = validate(lib);
  if (errs.length) {
    console.error('Generated library failed validation (retry with a larger model or fix the prompt):');
    for (const e of errs.slice(0, 20)) console.error('  -', e);
    process.exitCode = 1;
    return;
  }
  const out = join(HERE, 'persona-library.json');
  writeFileSync(out, JSON.stringify(lib, null, 2) + '\n');
  console.log(`wrote ${out}: ${personas.length} personas (model ${model})`);
}

// --- cli --------------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('--validate')) {
  const file = args[args.indexOf('--validate') + 1] || join(HERE, 'persona-library.example.json');
  const lib = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validate(lib);
  if (errs.length) {
    console.error(`INVALID: ${file}`);
    for (const e of errs) console.error('  -', e);
    process.exit(1);
  }
  const roles = new Set(lib.personas.map((p) => p.role));
  console.log(`VALID: ${file} — ${lib.personas.length} personas, roles: ${[...roles].join(', ')}`);
  process.exit(0);
} else if (args.includes('--count')) {
  await generate(Number(args[args.indexOf('--count') + 1] || 12));
} else {
  console.log('usage: node loadtest/personas/build-personas.mjs --validate [file] | --count N');
  process.exit(1);
}
