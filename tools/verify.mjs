// Two full builds, then the gate. node tools/verify.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = join(root, "_kit/input/snapshot.json");
let failed = 0;

function check(name, ok, detail) {
  if (!ok) failed += 1;
  process.stdout.write((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  " + detail : "") + "\n");
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path).map((rel) => name + "/" + rel));
    else out.push(name);
  }
  return out;
}

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function build(dir) {
  const run = spawnSync(process.execPath, [join(root, "main.ts"), "--input", input, "--output", dir], { stdio: "inherit" });
  return run.status === 0;
}

const dirA = join(root, "out/verify-a");
const dirB = join(root, "out/verify-b");
check("run-a", build(dirA));
check("run-b", build(dirB));
if (failed) process.exit(1);

const filesA = walk(dirA);
const filesB = walk(dirB);
check("same-paths", filesA.join("\n") === filesB.join("\n"), filesA.length + " paths");
let differ = 0;
for (const rel of filesA) {
  if (sha(join(dirA, rel)) !== sha(join(dirB, rel))) differ += 1;
}
check("byte-identical", differ === 0, differ ? differ + " files differ" : "sha256 match");

const snap = JSON.parse(readFileSync(input, "utf8"));
const board = JSON.parse(readFileSync(join(dirA, "board.json"), "utf8"));
const rows = board.rows;
const known = new Set(snap.protocols.map((p) => p.slug));
const seen = new Set();
const ranks = new Set();
let stepsOk = true;
let rowsOk = Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000;
if (rowsOk) {
  for (const row of rows) {
    if (!known.has(row.slug) || seen.has(row.slug)) rowsOk = false;
    seen.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank < 1 || ranks.has(row.rank)) rowsOk = false;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) rowsOk = false;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) stepsOk = false;
    else for (const step of row.farm_steps) {
      const n = String(step).trim().length;
      if (n < 20 || n > 600) stepsOk = false;
    }
  }
  for (let i = 1; i <= rows.length; i++) if (!ranks.has(i)) rowsOk = false;
}
check("rows-100-4000", rowsOk, rowsOk ? rows.length + " rows" : "bad rows");

const byRank = rowsOk ? rows.slice().sort((a, b) => a.rank - b.rank) : [];
let ordered = byRank.length > 1;
let same = ordered;
for (let i = 1; i < byRank.length; i++) {
  if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) ordered = false;
  if (byRank[i].implied_value_usd !== byRank[0].implied_value_usd) same = false;
}
check("value-non-increasing", ordered && !same, ordered ? "rank 1 $" + byRank[0].implied_value_usd : "order broken");

const missing = snap.watchlist.filter((slug) => !seen.has(slug));
check("watchlist-coverage", missing.length === 0, missing.length ? missing.slice(0, 5).join(", ") : snap.watchlist.length + "/" + snap.watchlist.length);
check("farm-steps", stepsOk, "3 to 12 steps, 20 to 600 chars");

const dashNames = readdirSync(join(dirA, "dashboard")).filter((n) => !n.startsWith(".")).sort();
let dashBytes = 0;
let httpHit = "";
for (const name of dashNames) {
  const text = readFileSync(join(dirA, "dashboard", name), "utf8");
  dashBytes += statSync(join(dirA, "dashboard", name)).size;
  if (text.includes("http://") || text.includes("https://")) httpHit = name;
}
const dataJs = readFileSync(join(dirA, "data.js"), "utf8");
if (dataJs.includes("http://") || dataJs.includes("https://")) httpHit = httpHit || "data.js";
check("dashboard-files", dashNames.includes("index.html") && dashNames.some((n) => n.endsWith(".css")) && dashNames.some((n) => n.endsWith(".js")) && dashNames.length <= 400 && dashBytes <= 60000 && !httpHit, dashNames.length + " files, " + dashBytes + " bytes" + (httpHit ? ", url in " + httpHit : ""));

const shots = readdirSync(join(dirA, "screenshots")).filter((n) => !n.startsWith(".")).sort();
let shotOk = shots.length >= 3 && shots.length <= 4;
const shotDetail = [];
for (const name of shots) {
  const buf = readFileSync(join(dirA, "screenshots", name));
  const size = pngSize(buf);
  const long = size ? Math.max(size.w, size.h) : 0;
  const short = size ? Math.min(size.w, size.h) : 0;
  if (!size || buf.length > 524288 || long > 1440 || short < 800) shotOk = false;
  shotDetail.push(name + " " + (size ? size.w + "x" + size.h : "?") + " " + buf.length);
}
check("screenshots", shotOk, shotDetail.join("; "));

const dossier = JSON.parse(readFileSync(join(dirA, "dossier.json"), "utf8"));
const text = typeof dossier.text === "string" ? dossier.text : "";
const cut = text.includes("not shown") || text.includes("left out");
check("dossier-text", text.length > 0 && !cut && statSync(join(dirA, "dossier.json")).size <= 1572864, text.length + " chars" + (cut ? " TRUNCATED" : ""));

process.stdout.write(failed ? "FAIL  " + failed + " checks failed\n" : "PASS  all checks\n");
process.exit(failed ? 1 : 0);
