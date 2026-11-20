// Token Radar entrypoint. Node 22 runs this file as TypeScript with the standard library only.
// It loads dashboard/model.js and dashboard/farm.js in a vm (the same source the page runs),
// writes board.json and data.js, copies dashboard/ and screenshots/, and builds dossier.json.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const DOSSIER_CAPS = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const VALUE_CAP = 100_000_000_000_000;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface FarmStep {
  title: string;
  detail: string;
  cost_usd: number;
  minutes: number;
  hold_days?: number;
  opp_usd?: number;
}

interface FarmPlan {
  steps: FarmStep[];
  totals: { cash_usd: number; minutes: number; hold_days: number; opp_usd: number };
  chain: string;
  ticket_usd: number;
}

interface ScoredRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  peer_multiple: number;
  peer_n: number;
  growth_factor: number;
  runway_factor: number;
  class_discount: number;
  launch_class: string;
  on_watchlist: boolean;
  token_status: string;
  implied_value_usd: number;
  airdrop_per_1k: number;
  growth_note: string;
  runway_note: string;
  listed_at: string | null;
}

interface Ranked {
  rows: ScoredRow[];
  peers: { all: { n: number; multiple: number } };
  token_on_record: number;
  token_trades: number;
}

interface ModelSummary {
  version: string;
  formula: string;
  lines: string[];
  constants: Record<string, number>;
}

interface RadarApi {
  rankBoard: (snapshot: Snapshot) => Ranked;
  tokenTradesTable: (snapshot: Snapshot) => unknown[];
  modelSummary: () => ModelSummary;
  buildFarmPlan: (row: ScoredRow, ctx: { as_of: string }) => FarmPlan;
  farmStepText: (step: FarmStep) => string;
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

function arg(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}`) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`missing value for --${name}`);
      return v;
    }
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail(`snapshot is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isObject(raw)) fail('snapshot is not an object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) fail('snapshot.as_of is not YYYY-MM-DD');
  if (typeof raw.source !== 'string' || raw.source.length === 0) fail('snapshot.source is empty');
  if (typeof raw.floor_usd !== 'number' || !Number.isFinite(raw.floor_usd) || raw.floor_usd <= 0) fail('snapshot.floor_usd is not a positive number');
  if (!Array.isArray(raw.protocols) || raw.protocols.length === 0) fail('snapshot.protocols is empty');
  if (!Array.isArray(raw.watchlist)) fail('snapshot.watchlist is not an array');

  const protocols: Protocol[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.protocols.length; i++) {
    const p = raw.protocols[i];
    if (!isObject(p)) fail(`protocols[${i}] is not an object`);
    const slug = p.slug;
    if (typeof slug !== 'string' || slug.length < 1 || slug.length > 128 || /\s/.test(slug)) fail(`protocols[${i}].slug is invalid`);
    if (seen.has(slug)) fail(`duplicate slug ${slug}`);
    seen.add(slug);
    if (typeof p.name !== 'string' || p.name.length === 0) fail(`${slug}: name is empty`);
    if (!isStringOrNull(p.category)) fail(`${slug}: category is not a string or null`);
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string')) fail(`${slug}: chains is not a string array`);
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) fail(`${slug}: tvl_usd is invalid`);
    if (!isNumberOrNull(p.change_7d)) fail(`${slug}: change_7d is invalid`);
    if (!isNumberOrNull(p.mcap_usd)) fail(`${slug}: mcap_usd is invalid`);
    if (!isStringOrNull(p.listed_at)) fail(`${slug}: listed_at is invalid`);
    if (p.listed_at !== null && !/^\d{4}-\d{2}-\d{2}$/.test(p.listed_at)) fail(`${slug}: listed_at is not YYYY-MM-DD`);
    if (!isStringOrNull(p.gecko_id)) fail(`${slug}: gecko_id is invalid`);
    if (!isStringOrNull(p.symbol)) fail(`${slug}: symbol is invalid`);
    protocols.push({
      slug,
      name: p.name,
      category: p.category,
      chains: p.chains.slice(),
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    });
  }
  const watchlist: string[] = [];
  for (let i = 0; i < raw.watchlist.length; i++) {
    const slug = raw.watchlist[i];
    if (typeof slug !== 'string' || !seen.has(slug)) fail(`watchlist entry is not a protocol slug: ${String(slug)}`);
    watchlist.push(slug);
  }
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd, protocols, watchlist };
}

function loadRadar(): RadarApi {
  const context: { TokenRadar?: RadarApi } = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(join(here, 'dashboard', 'model.js'), 'utf8'), context, { filename: 'dashboard/model.js' });
  vm.runInContext(readFileSync(join(here, 'dashboard', 'farm.js'), 'utf8'), context, { filename: 'dashboard/farm.js' });
  const api = context.TokenRadar;
  if (!api || typeof api.rankBoard !== 'function' || typeof api.buildFarmPlan !== 'function' || typeof api.farmStepText !== 'function') {
    fail('dashboard model did not export TokenRadar.rankBoard, buildFarmPlan, and farmStepText');
  }
  return api;
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  peer_multiple: number;
  peer_n: number;
  growth_factor: number;
  runway_factor: number;
  class_discount: number;
  launch_class: string;
  on_watchlist: boolean;
  token_status: string;
  airdrop_per_1k: number;
  farm_cost_usd: number;
  farm_minutes: number;
  farm_days: number;
  farm_opp_usd: number;
  farm_chain: string;
  farm_ticket_usd: number;
  growth_note: string;
  runway_note: string;
}

function assertBoard(rows: BoardRow[], snapshot: Snapshot): void {
  if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows; the gate wants 100 to 4000`);
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  for (const r of rows) {
    if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug)) fail(`bad slug ${String(r.slug)}`);
    if (!known.has(r.slug)) fail(`slug is not in the snapshot: ${r.slug}`);
    if (seen.has(r.slug)) fail(`duplicate slug ${r.slug}`);
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) fail(`empty name for ${r.slug}`);
    if (!Number.isInteger(r.rank) || r.rank < 1) fail(`bad rank for ${r.slug}`);
    if (ranks.has(r.rank)) fail(`duplicate rank ${r.rank}`);
    ranks.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > VALUE_CAP) {
      fail(`bad implied_value_usd for ${r.slug}: ${r.implied_value_usd}`);
    }
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      fail(`${r.slug}: farm_steps must hold 3 to 12 strings`);
    }
    for (const step of r.farm_steps) {
      if (typeof step !== 'string') fail(`${r.slug}: a farm step is not a string`);
      const n = step.trim().length;
      if (n < 20 || n > 600) fail(`${r.slug}: a farm step is ${n} characters; the gate wants 20 to 600`);
    }
  }
  for (let i = 1; i <= rows.length; i++) if (!ranks.has(i)) fail(`missing rank ${i}`);
  const byRank = rows.slice().sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      fail(`implied value rises at rank ${byRank[i]!.rank}`);
    }
  }
  if (byRank.every((r) => r.implied_value_usd === byRank[0]!.implied_value_usd)) fail('every implied value is equal, so this is not a ranking');
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) fail(`watchlist not covered: ${missing.slice(0, 8).join(', ')}`);
}

function listPlain(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && statSync(join(dir, name)).isFile())
    .sort();
}

function assertDashboard(dir: string): number {
  const names = listPlain(dir);
  if (!names.includes('index.html')) fail('dashboard/ has no index.html');
  if (!names.some((n) => n.endsWith('.css'))) fail('dashboard/ has no css file');
  if (!names.some((n) => n.endsWith('.js'))) fail('dashboard/ has no js file');
  if (names.length > 400) fail(`dashboard/ has ${names.length} files`);
  let bytes = 0;
  for (const name of names) {
    if (!PLAIN_NAME.test(name)) fail(`dashboard/${name}: name is not letters, digits and . _ -`);
    const text = readFileSync(join(dir, name), 'utf8');
    if (text.includes('http://') || text.includes('https://')) fail(`dashboard/${name} contains an http address`);
    bytes += statSync(join(dir, name)).size;
  }
  if (bytes > 4_194_304) fail(`dashboard/ is ${bytes} bytes`);
  if (bytes > 60_000) fail(`dashboard/ source is ${bytes} bytes; keep it under 60000 so the dossier text is not cut`);
  return bytes;
}

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function assertScreenshots(dir: string): string[] {
  if (!existsSync(dir)) fail('screenshots/ is missing');
  const names = listPlain(dir);
  if (names.length < 3 || names.length > 4) fail(`screenshots/ holds ${names.length} files; the gate wants 3 or 4`);
  for (const name of names) {
    if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: bad file name`);
    const buf = readFileSync(join(dir, name));
    if (buf.length > 524_288) fail(`screenshots/${name} is ${buf.length} bytes, over 512 KiB`);
    const size = pngSize(buf);
    const jpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!size && !jpeg) fail(`screenshots/${name} is not a PNG or JPEG`);
    if (size) {
      const long = Math.max(size.w, size.h);
      const short = Math.min(size.w, size.h);
      if (long > 1440) fail(`screenshots/${name} long side is ${long}, over 1440`);
      if (short < 800) fail(`screenshots/${name} short side is ${short}, under 800`);
    }
  }
  return names;
}

function copyFlat(from: string, to: string): string[] {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const names = listPlain(from);
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names;
}

function rewriteSource(source: string): string {
  const stripped = source.replace(/https?:\/\/[^\s,]+/g, '/protocols endpoint');
  return stripped.replace(/(\d{2}:\d{2}:\d{2})\.\d+Z/g, '$1Z');
}

function dataScript(snapshot: Snapshot): string {
  const payload = {
    as_of: snapshot.as_of,
    source: rewriteSource(snapshot.source),
    floor_usd: snapshot.floor_usd,
    watchlist: snapshot.watchlist,
    protocols: snapshot.protocols.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    })),
  };
  let json = JSON.stringify(payload);
  json = json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  if (json.includes('http://') || json.includes('https://')) fail('data.js would contain an http address');
  return `window.RADAR_SNAPSHOT = ${json};\n`;
}

const skipDossier = process.argv.includes('--skip-dossier');
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}`);

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const api = loadRadar();
const ranked = api.rankBoard(snapshot);
const summary = api.modelSummary();
const rows: BoardRow[] = ranked.rows.map((r) => {
  const plan = api.buildFarmPlan(r, { as_of: snapshot.as_of });
  const farm_steps = plan.steps.map((step) => api.farmStepText(step));
  return {
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.age_days,
    peer_multiple: r.peer_multiple,
    peer_n: r.peer_n,
    growth_factor: r.growth_factor,
    runway_factor: r.runway_factor,
    class_discount: r.class_discount,
    launch_class: r.launch_class,
    on_watchlist: r.on_watchlist,
    token_status: r.token_status,
    airdrop_per_1k: r.airdrop_per_1k,
    farm_cost_usd: plan.totals.cash_usd,
    farm_minutes: plan.totals.minutes,
    farm_days: plan.totals.hold_days,
    farm_opp_usd: plan.totals.opp_usd,
    farm_chain: plan.chain,
    farm_ticket_usd: plan.ticket_usd,
    growth_note: r.growth_note,
    runway_note: r.runway_note,
  };
});
assertBoard(rows, snapshot);

const dashBytes = assertDashboard(join(here, 'dashboard'));
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });

const covered = snapshot.watchlist.filter((slug) => rows.some((r) => r.slug === slug)).length;
const model = {
  version: summary.version,
  formula: summary.formula,
  lines: summary.lines,
  constants: summary.constants,
  as_of: snapshot.as_of,
  floor_usd: snapshot.floor_usd,
  peer_count: ranked.peers.all.n,
  field_median_multiple: ranked.peers.all.multiple,
  pre_token_count: rows.length,
  watchlist_count: snapshot.watchlist.length,
  watchlist_covered: covered,
  token_trades_count: ranked.token_trades,
  token_on_record_count: ranked.token_on_record,
};
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model, rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(snapshot));
const dashCopied = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));

let shotNames: string[] = [];
if (!skipDossier) {
  shotNames = assertScreenshots(join(here, 'screenshots'));
  copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
  const dossierPath = join(out, 'dossier.json');
  writeFileSync(dossierPath, buildDossier(out, DOSSIER_CAPS));
  const dossier = JSON.parse(readFileSync(dossierPath, 'utf8')) as { text?: string };
  if (typeof dossier.text !== 'string') fail('dossier has no text');
  if (dossier.text.includes('not shown') || dossier.text.includes('left out')) {
    fail('dossier text was truncated; shrink dashboard/ so the judge reads every file');
  }
  const digest = createHash('sha256').update(readFileSync(dossierPath)).digest('hex').slice(0, 12);
  process.stdout.write(`token radar: dossier ${digest} text ${dossier.text.length} chars\n`);
} else if (existsSync(join(here, 'screenshots'))) {
  copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
}

const top = rows[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} pre-token rows, ${ranked.token_trades} tokens already trade, ${ranked.token_on_record} on record with no market cap\n` +
    `token radar: rank 1 ${top.slug} ${top.launch_class} $${top.implied_value_usd} peer x${top.peer_multiple} (n=${ranked.peers.all.n} field median x${ranked.peers.all.multiple}); dashboard ${dashCopied.length} files, ${dashBytes} bytes; wrote ${out}\n`,
);
