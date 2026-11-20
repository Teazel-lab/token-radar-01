// Value model for the page and main.ts. FDV = TVL x peerMultiple x growthFactor x runwayFactor x classDiscount.
var MODEL_VERSION = "fdv-shrink-1";
var SHRINK_K = 4, MULTIPLE_MIN = 0.03, MULTIPLE_MAX = 2.5;
var GROWTH_LO = -40, GROWTH_HI = 60, GROWTH_EXP = 0.5;
var RUNWAY_BASE = 0.8, RUNWAY_SPAN = 0.45, RUNWAY_CAP_DAYS = 900, RUNWAY_UNKNOWN = 0.9;
var DERIVATIVE_DISCOUNT = 0.35, AIRDROP_SHARE = 0.1, VALUE_CAP = 100000000000000;
var DERIVATIVE_CATEGORY = { "Bridge": 1, "Canonical Bridge": 1, "Liquid Staking": 1, "Liquid Restaking": 1, "Restaked BTC": 1, "CEX": 1 };
var VERSION_MARKER = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
var WRAPPER_WORD = /\b(?:wrapped|staked|staking)\b/i;
var EXCHANGE_PREFIX = /^(?:Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
function round6(n) {
 return Math.round(n * 1000000) / 1000000;
}
function roundCents(n) {
 return Math.round(n * 100) / 100;
}
function groupDigits(intText) {
 var s = String(intText);
 var out = "";
 for (var i = 0; i < s.length; i++) {
  if (i > 0 && (s.length - i) % 3 === 0) out += ",";
  out += s.charAt(i);
 }
 return out;
}
function formatUsd(n) {
 if (n == null || !isFinite(n)) return "n/a";
 var neg = n < 0;
 var cents = Math.round(Math.abs(n) * 100);
 var dollars = Math.floor(cents / 100);
 var rem = cents % 100;
 var body = "$" + groupDigits(dollars);
 if (rem !== 0) body += "." + (rem < 10 ? "0" : "") + rem;
 return neg ? "-" + body : body;
}
function formatUsdCompact(n) {
 if (n == null || !isFinite(n)) return "n/a";
 var neg = n < 0;
 var v = Math.abs(n);
 var unit = "";
 var x = v;
 if (v >= 1e12) { x = v / 1e12; unit = "T"; }
 else if (v >= 1e9) { x = v / 1e9; unit = "B"; }
 else if (v >= 1e6) { x = v / 1e6; unit = "M"; }
 else if (v >= 1e4) { x = v / 1e3; unit = "K"; }
 else return formatUsd(n);
 var t = Math.round(x * 100);
 var whole = Math.floor(t / 100);
 var frac = t % 100;
 var num = groupDigits(whole);
 if (frac !== 0) {
  var fs = (frac < 10 ? "0" : "") + frac;
  if (fs.charAt(1) === "0") fs = fs.charAt(0);
  num += "." + fs;
 }
 return (neg ? "-" : "") + "$" + num + unit;
}
function formatPct(p) {
 if (p == null || !isFinite(p)) return "unreported";
 var sign = p > 0 ? "+" : p < 0 ? "-" : "";
 var tenths = Math.round(Math.abs(p) * 10);
 var whole = Math.floor(tenths / 10);
 var d = tenths % 10;
 return sign + whole + "." + d + "%";
}
function formatAge(days) {
 if (days == null) return "unlisted";
 if (days < 60) return days + "d";
 if (days < 365) return Math.round(days / 30) + "mo";
 var tenths = Math.round(days * 10 / 365);
 var whole = Math.floor(tenths / 10);
 var d = tenths % 10;
 return d === 0 ? whole + "y" : whole + "." + d + "y";
}
function parseYmd(s) {
 if (typeof s !== "string") return null;
 var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
 if (!m) return null;
 return { y: +m[1], mo: +m[2], d: +m[3] };
}
function tokenFreeDays(listedAt, asOf) {
 var a = parseYmd(listedAt);
 var b = parseYmd(asOf);
 if (!a || !b) return null;
 var ms = Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d);
 var days = Math.round(ms / 86400000);
 return days < 0 ? 0 : days;
}
function watchHas(watchlist, slug) {
 if (!watchlist) return false;
 if (typeof watchlist.has === "function") return watchlist.has(slug);
 if (Array.isArray(watchlist)) {
  for (var i = 0; i < watchlist.length; i++) if (watchlist[i] === slug) return true;
 }
 return false;
}
function classifyTokenStatus(p) {
 if (p.gecko_id == null && p.symbol == null) return "pre-token";
 if (typeof p.mcap_usd === "number" && p.mcap_usd > 0) return "token trades";
 return "token on record";
}
function derivativeHits(p) {
 var hits = [];
 if (p.category && DERIVATIVE_CATEGORY[p.category]) hits.push("category " + p.category);
 if (typeof p.name === "string" && VERSION_MARKER.test(p.name)) hits.push("version marker in the name");
 if (typeof p.name === "string" && WRAPPER_WORD.test(p.name)) hits.push("name says wrapped, staked, or staking");
 if (typeof p.name === "string" && EXCHANGE_PREFIX.test(p.name)) hits.push("name starts with an exchange");
 return hits;
}
function classifyLaunchClass(p, watchlist, floor) {
 if (watchHas(watchlist, p.slug)) return "watchlist";
 if (derivativeHits(p).length > 0) return "derivative";
 // Early covers both a TVL under `floor` and a protocol the list left off. explainLaunchClass states which.
 return "early";
}
function explainLaunchClass(p, watchlist, floor) {
 var cls = classifyLaunchClass(p, watchlist, floor);
 if (cls === "watchlist") return "On the snapshot watchlist: TVL is at or above the floor, it records no token, and the name and category are not a wrapper.";
 if (cls === "derivative") return "Derivative (" + derivativeHits(p).join("; ") + "). Class discount " + DERIVATIVE_DISCOUNT + " because the deposits are a wrapper, a bridge balance, or an exchange book.";
 if (typeof floor === "number" && p.tvl_usd < floor) return "Early: records no token and sits below the watchlist floor, so the list never started here.";
 return "Early: records no token and is off the watchlist.";
}
function medianSorted(sorted) {
 var n = sorted.length;
 if (n === 0) return null;
 var mid = Math.floor(n / 2);
 if (n % 2 === 1) return sorted[mid];
 return (sorted[mid - 1] + sorted[mid]) / 2;
}
function clampMultiple(x) {
 if (x < MULTIPLE_MIN) return MULTIPLE_MIN;
 if (x > MULTIPLE_MAX) return MULTIPLE_MAX;
 return x;
}
function calibratePeerMultiples(protocols) {
 var logsByCat = {};
 var allLogs = [];
 for (var i = 0; i < protocols.length; i++) {
  var p = protocols[i];
  if (!(typeof p.mcap_usd === "number" && p.mcap_usd > 0 && typeof p.tvl_usd === "number" && p.tvl_usd > 0)) continue;
  var ratio = p.mcap_usd / p.tvl_usd;
  if (!(ratio > 0) || !isFinite(ratio)) continue;
  var log = Math.log(ratio);
  allLogs.push(log);
  var cat = p.category || "Uncategorised";
  if (!logsByCat[cat]) logsByCat[cat] = [];
  logsByCat[cat].push(log);
 }
 allLogs.sort(function (a, b) { return a - b; });
 if (allLogs.length === 0) {
  return { byCategory: {}, all: { n: 0, multiple: 1, median_log: 0 }, k: SHRINK_K };
 }
 var allMedian = medianSorted(allLogs);
 var fieldMultiple = round6(clampMultiple(Math.exp(allMedian)));
 var byCategory = {};
 var cats = Object.keys(logsByCat).sort();
 for (var c = 0; c < cats.length; c++) {
  var name = cats[c];
  var arr = logsByCat[name].slice().sort(function (a, b) { return a - b; });
  var n = arr.length;
  var catMedian = medianSorted(arr);
  var weight = n / (n + SHRINK_K);
  var shrunk = weight * catMedian + (1 - weight) * allMedian;
  byCategory[name] = {
   n: n,
   weight: round6(weight),
   category_median_multiple: round6(Math.exp(catMedian)),
   multiple: round6(clampMultiple(Math.exp(shrunk)))
  };
 }
 return {
  byCategory: byCategory,
  all: { n: allLogs.length, multiple: fieldMultiple, median_log: allMedian },
  k: SHRINK_K
 };
}
function peerMultipleFor(category, peers) {
 var row = peers.byCategory[category || "Uncategorised"];
 if (!row) return { multiple: peers.all.multiple, n: 0, weight: 0 };
 return { multiple: row.multiple, n: row.n, weight: row.weight };
}
function growthFactor(change7d) {
 if (change7d == null || typeof change7d !== "number" || !isFinite(change7d)) {
  return { factor: 1, note: "7d unreported", clamped: null };
 }
 var c = change7d;
 if (c < GROWTH_LO) c = GROWTH_LO;
 if (c > GROWTH_HI) c = GROWTH_HI;
 return { factor: round6(Math.exp(GROWTH_EXP * c / 100)), note: "", clamped: c };
}
function runwayFactor(ageDays) {
 if (ageDays == null || typeof ageDays !== "number" || !isFinite(ageDays)) {
  return { factor: RUNWAY_UNKNOWN, note: "listed_at unreported" };
 }
 var age = ageDays < 0 ? 0 : ageDays;
 var capped = age > RUNWAY_CAP_DAYS ? RUNWAY_CAP_DAYS : age;
 return { factor: round6(RUNWAY_BASE + RUNWAY_SPAN * capped / RUNWAY_CAP_DAYS), note: "" };
}
function derivativeDiscount(launchClass) {
 return launchClass === "derivative" ? DERIVATIVE_DISCOUNT : 1;
}
function impliedValue(p, ctx) {
 var launch = classifyLaunchClass(p, ctx.watchlist, ctx.floor_usd);
 var age = tokenFreeDays(p.listed_at, ctx.as_of);
 var growth = growthFactor(p.change_7d);
 var runway = runwayFactor(age);
 var peer = peerMultipleFor(p.category, ctx.peers);
 var discount = derivativeDiscount(launch);
 var tvl = typeof p.tvl_usd === "number" ? p.tvl_usd : 0;
 var product = tvl * peer.multiple * growth.factor * runway.factor * discount;
 var implied = Math.round(product);
 if (!isFinite(implied) || implied < 1) implied = 1;
 if (implied > VALUE_CAP) implied = VALUE_CAP;
 var per1k = tvl > 0 ? roundCents(AIRDROP_SHARE * implied * 1000 / tvl) : 0;
 return {
  token_status: classifyTokenStatus(p),
  launch_class: launch,
  age_days: age,
  peer_multiple: peer.multiple,
  peer_n: peer.n,
  peer_weight: peer.weight,
  growth_factor: growth.factor,
  growth_note: growth.note,
  runway_factor: runway.factor,
  runway_note: runway.note,
  class_discount: discount,
  implied_value_usd: implied,
  airdrop_per_1k: per1k
 };
}
function rowFromProtocol(p, score, onList) {
 var row = {
  slug: p.slug, name: p.name, category: p.category, chains: p.chains.slice(),
  tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, on_watchlist: onList
 };
 var keys = ["age_days", "token_status", "launch_class", "peer_multiple", "peer_n", "peer_weight", "growth_factor", "growth_note", "runway_factor", "runway_note", "class_discount", "implied_value_usd", "airdrop_per_1k"];
 for (var i = 0; i < keys.length; i++) row[keys[i]] = score[keys[i]];
 return row;
}
function rankBoard(snapshot) {
 var watch = new Set(snapshot.watchlist);
 var peers = calibratePeerMultiples(snapshot.protocols);
 var ctx = { as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, watchlist: watch, peers: peers };
 var rows = [];
 var onRecord = 0;
 var trades = 0;
 for (var i = 0; i < snapshot.protocols.length; i++) {
  var p = snapshot.protocols[i];
  var status = classifyTokenStatus(p);
  if (status === "token trades") { trades += 1; continue; }
  if (status === "token on record") { onRecord += 1; continue; }
  var score = impliedValue(p, ctx);
  rows.push(rowFromProtocol(p, score, watch.has(p.slug)));
 }
 rows.sort(function (a, b) {
  if (a.implied_value_usd !== b.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
 });
 var rankedSlug = {};
 for (var r = 0; r < rows.length; r++) { rows[r].rank = r + 1; rankedSlug[rows[r].slug] = 1; }
 for (var w = 0; w < snapshot.watchlist.length; w++) {
  if (!rankedSlug[snapshot.watchlist[w]]) throw new Error("rankBoard: watchlist slug not ranked: " + snapshot.watchlist[w]);
 }
 return { rows: rows, peers: peers, token_on_record: onRecord, token_trades: trades };
}
function tokenTradesTable(snapshot) {
 var rows = [];
 for (var i = 0; i < snapshot.protocols.length; i++) {
  var p = snapshot.protocols[i];
  if (classifyTokenStatus(p) !== "token trades") continue;
  var multiple = p.tvl_usd > 0 ? round6(p.mcap_usd / p.tvl_usd) : null;
  rows.push({
   slug: p.slug,
   name: p.name,
   category: p.category,
   chains: p.chains.slice(),
   tvl_usd: p.tvl_usd,
   mcap_usd: p.mcap_usd,
   change_7d: p.change_7d,
   listed_at: p.listed_at,
   symbol: p.symbol,
   multiple: multiple
  });
 }
 rows.sort(function (a, b) {
  if (a.mcap_usd !== b.mcap_usd) return b.mcap_usd - a.mcap_usd;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
 });
 return rows;
}
function modelSummary() {
 return {
  version: MODEL_VERSION,
  formula: "Implied FDV = TVL x peer mcap/TVL (category, shrunk) x 7-day growth x token-free runway x class discount",
  lines: [
   "Pre-token: gecko_id and symbol are both null, so it records no token. A positive market cap calibrates peers and stays off the board.",
   "A symbol or gecko id with no market cap is priced by neither table.",
   "Peer multiple: median log(mcap/TVL) in the category, shrunk to the field with weight n/(n+4), k=4, then exp, clamped to 0.03..2.5.",
   "Growth: exp(0.5 x clamp(7d change, -40, 60) / 100); unreported uses 1. Runway: 0.8 + 0.45 x min(age, 900) / 900 UTC days; unknown listed_at uses 0.9.",
   "Watchlist if the slug is listed, else derivative (bridge, liquid staking, restaked BTC, CEX, version marker, wrapped/staked, or an exchange name) at 0.35, else early at 1.",
   "Per $1,000 is 10% of stated FDV shared pro rata with TVL. An illustration, not a promised airdrop."
  ],
  constants: {
   shrink_k: SHRINK_K, multiple_min: MULTIPLE_MIN, multiple_max: MULTIPLE_MAX,
   growth_lo: GROWTH_LO, growth_hi: GROWTH_HI, growth_exp: GROWTH_EXP,
   runway_base: RUNWAY_BASE, runway_span: RUNWAY_SPAN, runway_cap_days: RUNWAY_CAP_DAYS, runway_unknown: RUNWAY_UNKNOWN,
   derivative_discount: DERIVATIVE_DISCOUNT, airdrop_share: AIRDROP_SHARE
  }
 };
}
globalThis.TokenRadar = {
 MODEL_VERSION: MODEL_VERSION,
 classifyTokenStatus: classifyTokenStatus, classifyLaunchClass: classifyLaunchClass, explainLaunchClass: explainLaunchClass,
 calibratePeerMultiples: calibratePeerMultiples, peerMultipleFor: peerMultipleFor,
 growthFactor: growthFactor, runwayFactor: runwayFactor, derivativeDiscount: derivativeDiscount, tokenFreeDays: tokenFreeDays,
 impliedValue: impliedValue, rankBoard: rankBoard, tokenTradesTable: tokenTradesTable, modelSummary: modelSummary,
 formatUsd: formatUsd, formatUsdCompact: formatUsdCompact, formatPct: formatPct, formatAge: formatAge
};
