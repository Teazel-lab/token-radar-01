// Page over model.js and farm.js. Hash: #/ board, #/p/<slug> detail, query filters.
var STATE = { snap: null, rows: [], live: [], peers: null, summary: null, onRecord: 0 };
var restoreSearch = false;
var lastBoard = "/";
function formatUsd(n) { return TokenRadar.formatUsd(n); }
function formatUsdCompact(n) { return TokenRadar.formatUsdCompact(n); }
function formatPct(n) { return TokenRadar.formatPct(n); }
function formatAge(n) { return TokenRadar.formatAge(n); }
function formatFactor(n) {
if (n == null || !isFinite(n)) return "n/a";
var sign = n < 0 ? "-" : "";
var t = Math.round(Math.abs(n) * 10000);
var whole = Math.floor(t / 10000);
var frac = String(t % 10000);
while (frac.length < 4) frac = "0" + frac;
while (frac.length > 2 && frac.charAt(frac.length - 1) === "0") frac = frac.slice(0, -1);
return sign + whole + "." + frac;
}
function esc(s) {
return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function capClass(s) {
if (s === "watchlist") return "Watchlist";
if (s === "early") return "Early";
if (s === "derivative") return "Derivative";
return s || "";
}
function catOf(row) { return row.category || "Uncategorised"; }
function chainLabel(chains, max) {
if (!chains || !chains.length) return "no chain listed";
if (chains.length <= max) return chains.join(", ");
return chains.slice(0, max).join(", ") + " +" + (chains.length - max);
}
function parseRoute() {
var raw = location.hash || "#/";
if (raw.charAt(0) === "#") raw = raw.slice(1);
if (!raw) raw = "/";
var qAt = raw.indexOf("?");
var path = qAt >= 0 ? raw.slice(0, qAt) : raw;
var params = {};
var bits = qAt >= 0 && raw.slice(qAt + 1) ? raw.slice(qAt + 1).split("&") : [];
for (var i = 0; i < bits.length; i++) {
if (!bits[i]) continue;
var eq = bits[i].indexOf("=");
var k = decodeURIComponent(eq >= 0 ? bits[i].slice(0, eq) : bits[i]);
params[k] = decodeURIComponent(eq >= 0 ? bits[i].slice(eq + 1) : "");
}
var slug = path.indexOf("/p/") === 0 ? decodeURIComponent(path.slice(3)) : "";
var tab = params.tab === "live" ? "live" : "pre";
return {
view: slug ? "detail" : "board",
slug: slug,
cls: params["class"] || "all",
chain: params.chain || "",
cat: params.cat || "",
minTvl: params.minTvl || "",
q: params.q || "",
sort: params.sort || (tab === "live" ? "mcap" : "rank"),
dir: params.dir || (tab === "live" ? "desc" : "asc"),
tab: tab
};
}
function buildHash(route) {
if (route.view === "detail" && route.slug) return "/p/" + encodeURIComponent(route.slug);
var parts = [];
function add(k, v) { if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); }
if (route.tab === "live") add("tab", "live");
if (route.cls && route.cls !== "all") add("class", route.cls);
add("chain", route.chain);
add("cat", route.cat);
add("minTvl", route.minTvl);
add("q", route.q);
var sortDefault = route.tab === "live" ? "mcap" : "rank";
var dirDefault = route.tab === "live" ? "desc" : "asc";
if ((route.sort || sortDefault) !== sortDefault) add("sort", route.sort);
if ((route.dir || dirDefault) !== dirDefault) add("dir", route.dir);
return "/" + (parts.length ? "?" + parts.join("&") : "");
}
function preferredDir(key) {
if (key === "rank" || key === "name" || key === "farm" || key === "cat") return "asc";
return "desc";
}
function applyFilters(rows, route) {
var q = route.q.trim().toLowerCase();
var minTvl = route.minTvl ? +route.minTvl : 0;
var out = [];
for (var i = 0; i < rows.length; i++) {
var r = rows[i];
if (route.tab !== "live" && route.cls !== "all" && r.launch_class !== route.cls) continue;
if (route.cat && catOf(r) !== route.cat) continue;
if (route.chain && r.chains.indexOf(route.chain) < 0) continue;
if (minTvl && r.tvl_usd < minTvl) continue;
if (q && (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase().indexOf(q) < 0) continue;
out.push(r);
}
return out;
}
function sortValue(row, key) {
if (key === "name") return row.name ? row.name.toLowerCase() : "";
if (key === "farm") return row.plan ? row.plan.totals.cash_usd : null;
var field = {
rank: "rank", tvl: "tvl_usd", growth: "change_7d", age: "age_days", peer: "peer_multiple",
value: "implied_value_usd", per1k: "airdrop_per_1k", mcap: "mcap_usd", multiple: "multiple",
class: "launch_class", cat: "category"
}[key];
return field ? row[field] : null;
}
function sortRows(rows, key, dir) {
var sign = dir === "asc" ? 1 : -1;
var out = rows.slice();
out.sort(function (a, b) {
var va = sortValue(a, key);
var vb = sortValue(b, key);
var na = va == null || va !== va;
var nb = vb == null || vb !== vb;
if (na || nb) {
if (na && nb) return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
return na ? 1 : -1;
}
if (va < vb) return -sign;
if (va > vb) return sign;
if (a.slug < b.slug) return -1;
if (a.slug > b.slug) return 1;
return 0;
});
return out;
}
function summarize(rows) {
var sum = 0;
var changes = [];
var cheapest = null;
var watch = 0;
for (var i = 0; i < rows.length; i++) {
var r = rows[i];
if (r.implied_value_usd) sum += r.implied_value_usd;
if (r.change_7d != null && isFinite(r.change_7d)) changes.push(r.change_7d);
if (r.on_watchlist) watch += 1;
if (r.plan) {
var cost = r.plan.totals.cash_usd;
if (!cheapest || cost < cheapest.plan.totals.cash_usd || (cost === cheapest.plan.totals.cash_usd && r.slug < cheapest.slug)) cheapest = r;
}
}
changes.sort(function (a, b) { return a - b; });
var mid = null;
if (changes.length) {
var m = Math.floor(changes.length / 2);
mid = changes.length % 2 ? changes[m] : (changes[m - 1] + changes[m]) / 2;
}
return { count: rows.length, sum: sum, median7d: mid, cheapest: cheapest, watch: watch };
}
function radarMark() {
return '<svg width="28" height="28" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="none" stroke="#2fe3c2" stroke-width="1.5"/><circle cx="16" cy="16" r="6" fill="none" stroke="#2fe3c2" opacity=".65"/><path d="M16 16L27 8A12 12 0 0 0 16 4Z" fill="#2fe3c2" opacity=".28"/><circle cx="16" cy="16" r="2" fill="#ffb020"/></svg>';
}
function renderHeader() {
var snap = STATE.snap;
return '<header class="top"><div class="brand">' + radarMark() +
'<div><h1>Token Radar <span class="ver">' + esc(STATE.summary.version) + '</span></h1>' +
'<p>Implied FDV for protocols that record no token</p></div></div>' +
'<div class="meta-side"><div class="asof">Snapshot ' + esc(snap.as_of) + '</div>' +
'<div class="src">' + esc(snap.source) + '</div></div></header>';
}
function renderKpis() {
var covered = 0;
var sum = 0;
for (var i = 0; i < STATE.rows.length; i++) {
if (STATE.rows[i].on_watchlist) covered += 1;
sum += STATE.rows[i].implied_value_usd;
}
var cells = [
["cover", "Watchlist covered", covered + "/" + STATE.snap.watchlist.length],
["", "Pre-token ranked", String(STATE.rows.length)],
["", "Token already trades", String(STATE.live.length)],
["", "Peers in the model", String(STATE.peers.all.n)],
["", "Median peer multiple", formatFactor(STATE.peers.all.multiple) + "x"],
["value", "Combined implied FDV", formatUsdCompact(sum)]
];
var html = '<section class="kpis">';
for (var c = 0; c < cells.length; c++) {
html += '<div class="kpi ' + cells[c][0] + '"><span>' + cells[c][1] + '</span><b class="num">' + esc(cells[c][2]) + '</b></div>';
}
return html + "</section>";
}
function renderFormulaRibbon(top) {
if (!top) return '<div class="ribbon">No protocol in this view.</div>';
var growth = top.growth_note ? "7d unreported" : formatPct(top.change_7d) + " 7d";
var runway = top.runway_note ? "listed_at unreported" : formatAge(top.age_days);
var peers = top.peer_n === 1 ? "1 peer" : top.peer_n + " peers";
return '<div class="ribbon">Implied FDV = TVL × peer mcap/TVL × 7-day growth × token-free runway × class discount · <b>' +
esc(top.name) + "</b> " + formatUsdCompact(top.tvl_usd) + " × " + formatFactor(top.peer_multiple) +
" (" + esc(catOf(top)) + ", " + peers + ") × " + formatFactor(top.growth_factor) + " (" + growth + ") × " +
formatFactor(top.runway_factor) + " (" + runway + ") × " + formatFactor(top.class_discount) +
' = <b class="amber">' + formatUsdCompact(top.implied_value_usd) + "</b></div>";
}
function optionList(rows, pick) {
var seen = {};
var out = [];
for (var i = 0; i < rows.length; i++) {
var values = pick(rows[i]);
for (var j = 0; j < values.length; j++) {
var v = values[j];
if (!v || seen[v]) continue;
seen[v] = 1;
out.push(v);
}
}
out.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
return out;
}
function selectHtml(id, label, current, pairs) {
var html = '<select id="' + id + '" aria-label="' + label + '">';
for (var i = 0; i < pairs.length; i++) {
html += '<option value="' + esc(pairs[i][0]) + '"' + (current === pairs[i][0] ? " selected" : "") + ">" + esc(pairs[i][1]) + "</option>";
}
return html + "</select>";
}
function namedPairs(values, any) {
var pairs = [["", any]];
for (var i = 0; i < values.length; i++) pairs.push([values[i], values[i]]);
return pairs;
}
function renderFilters(route, shown, total) {
var counts = { all: STATE.rows.length, watchlist: 0, early: 0, derivative: 0 };
for (var i = 0; i < STATE.rows.length; i++) counts[STATE.rows[i].launch_class] += 1;
var universe = route.tab === "live" ? STATE.live : STATE.rows;
var html = '<div class="controls"><div class="control-row"><div class="tabs">';
html += '<button data-act="tab" data-tab="pre" aria-selected="' + (route.tab !== "live") + '">Pre-token board (' + STATE.rows.length + ")</button>";
html += '<button data-act="tab" data-tab="live" aria-selected="' + (route.tab === "live") + '">Token already trades (' + STATE.live.length + ")</button>";
html += '</div><div class="spacer"></div><div class="showing">showing ' + shown + " of " + total + "</div></div>";
html += '<div class="control-row"><input id="q" type="search" aria-label="Search protocols" placeholder="Search name, slug, category" value="' + esc(route.q) + '">';
if (route.tab !== "live") {
html += '<div class="seg" role="group" aria-label="Launch class">';
var classes = [["all", "All " + counts.all], ["watchlist", "Watchlist " + counts.watchlist], ["early", "Early " + counts.early], ["derivative", "Derivative " + counts.derivative]];
for (var k = 0; k < classes.length; k++) {
html += '<button data-act="class" data-class="' + classes[k][0] + '" aria-pressed="' + (route.cls === classes[k][0]) + '">' + classes[k][1] + "</button>";
}
html += "</div>";
}
html += selectHtml("cat", "Category", route.cat, namedPairs(optionList(universe, function (r) { return [catOf(r)]; }), "All categories"));
html += selectHtml("chain", "Chain", route.chain, namedPairs(optionList(universe, function (r) { return r.chains; }), "All chains"));
html += selectHtml("minTvl", "Minimum TVL", route.minTvl, [
["", "Any TVL"], ["10000000", "$10M+"], ["25000000", "$25M+"], ["50000000", "$50M+"],
["100000000", "$100M+"], ["500000000", "$500M+"], ["1000000000", "$1B+"]
]);
html += "</div>";
var chips = [];
if (route.cls !== "all") chips.push(["class", capClass(route.cls)]);
if (route.chain) chips.push(["chain", route.chain]);
if (route.cat) chips.push(["cat", route.cat]);
if (route.minTvl) chips.push(["minTvl", "TVL " + formatUsdCompact(+route.minTvl) + "+"]);
if (route.q) chips.push(["q", route.q]);
if (chips.length) {
html += '<div class="chips">';
for (var n = 0; n < chips.length; n++) html += '<button class="chip" data-act="clear" data-key="' + chips[n][0] + '">' + esc(chips[n][1]) + " <i>×</i></button>";
html += '<button class="chip" data-act="reset">Clear filters</button></div>';
}
return html + "</div>";
}
function th(label, key, route, num) {
var sorted = route.sort === key;
var aria = sorted ? (route.dir === "asc" ? "ascending" : "descending") : "none";
var arrow = sorted ? (route.dir === "asc" ? " ▲" : " ▼") : "";
return '<th class="' + (num ? "num " : "") + (sorted ? "sorted" : "") + '" aria-sort="' + aria + '"><button data-act="sort" data-key="' + key + '">' + label + arrow + "</button></th>";
}
function pctSpan(v) {
var cls = v == null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";
return '<span class="' + cls + '">' + formatPct(v) + "</span>";
}
function renderBoardTable(rows, route) {
var max = 1;
for (var i = 0; i < rows.length; i++) if (rows[i].implied_value_usd > max) max = rows[i].implied_value_usd;
var head = th("Rank", "rank", route, false) + th("Protocol", "name", route, false) + th("Class", "class", route, false) +
th("TVL", "tvl", route, true) + th("7d", "growth", route, true) + th("Runway", "age", route, true) +
th("Peer", "peer", route, true) + th("Implied FDV", "value", route, true) + th("Per $1k", "per1k", route, true) +
th("Farm plan", "farm", route, true);
var body = rows.length ? "" : '<tr><td colspan="10" class="empty">No protocols match these filters.</td></tr>';
for (var r = 0; r < rows.length; r++) {
var row = rows[r];
var width = Math.max(4, Math.round(100 * row.implied_value_usd / max));
var plan = row.plan.totals;
body += "<tr" + (row.on_watchlist ? ' class="wl"' : "") + ' data-slug="' + esc(row.slug) + '"><td class="num">' + row.rank +
'</td><td><div class="name">' + esc(row.name) + '</div><div class="sub">' + esc(catOf(row)) + " · " + esc(chainLabel(row.chains, 2)) +
'</div></td><td><span class="badge ' + row.launch_class + '">' + capClass(row.launch_class) + '</span></td><td class="num">' +
formatUsdCompact(row.tvl_usd) + '</td><td class="num">' + pctSpan(row.change_7d) + '</td><td class="num">' + formatAge(row.age_days) +
'</td><td class="num">' + formatFactor(row.peer_multiple) + '×<div class="sub">n=' + row.peer_n + '</div></td><td class="num"><div class="fdv">' +
formatUsdCompact(row.implied_value_usd) + '</div><div class="bar"><i style="width:' + width + '%"></i></div></td><td class="num">' +
formatUsd(row.airdrop_per_1k) + '</td><td class="num">' + formatUsd(plan.cash_usd) + '<div class="sub">' + plan.minutes + " min · " + plan.hold_days + "d</div></td></tr>";
}
return '<div class="table-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}
function renderTokenTradesTable(rows, route) {
var head = th("Protocol", "name", route, false) + th("Category", "cat", route, false) + th("TVL", "tvl", route, true) +
th("Market cap", "mcap", route, true) + th("Mcap/TVL", "multiple", route, true) + th("7d", "growth", route, true);
var body = rows.length ? "" : '<tr><td colspan="6" class="empty">No trading tokens match these filters.</td></tr>';
for (var i = 0; i < rows.length; i++) {
var row = rows[i];
body += '<tr data-slug="' + esc(row.slug) + '"><td><div class="name">' + esc(row.name) + '</div><div class="sub">' +
esc(row.symbol || "") + " · " + esc(chainLabel(row.chains, 2)) + "</div></td><td>" + esc(catOf(row)) +
'</td><td class="num">' + formatUsdCompact(row.tvl_usd) + '</td><td class="num">' + formatUsdCompact(row.mcap_usd) +
'</td><td class="num">' + formatFactor(row.multiple) + '×</td><td class="num">' + pctSpan(row.change_7d) + "</td></tr>";
}
return '<div class="table-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
}
function stat(label, value) {
return '<div class="stat"><span>' + esc(label) + '</span><b class="num">' + esc(value) + "</b></div>";
}
function renderRail(rows, route) {
var s = summarize(rows);
var cheap = "n/a";
if (s.cheapest) cheap = formatUsd(s.cheapest.plan.totals.cash_usd) + " · " + s.cheapest.plan.totals.minutes + " min";
var html = '<aside class="rail"><section class="card"><h2>This view</h2>' + stat("Protocols", String(s.count));
if (route.tab !== "live") {
html += stat("Combined implied FDV", formatUsdCompact(s.sum));
html += stat("Median 7d", s.median7d == null ? "unreported" : formatPct(s.median7d));
html += stat("Cheapest plan", cheap);
html += stat("Watchlist in view", s.watch + " / " + STATE.snap.watchlist.length);
} else {
html += stat("Field median mcap/TVL", formatFactor(STATE.peers.all.multiple) + "×");
html += stat("Symbol, no market cap", String(STATE.onRecord));
}
html += '</section><section class="card how"><h2>How the value is stated</h2>';
var lines = STATE.summary.lines;
for (var i = 0; i < lines.length; i++) html += "<p>" + esc(lines[i]) + "</p>";
return html + "</section></aside>";
}
function renderBoard(route) {
lastBoard = buildHash(route);
var base = route.tab === "live" ? STATE.live : STATE.rows;
var shown = sortRows(applyFilters(base, route), route.sort, route.dir);
var covered = 0;
for (var i = 0; i < STATE.rows.length; i++) if (STATE.rows[i].on_watchlist) covered += 1;
var headline = route.tab === "live"
? STATE.live.length + " protocols whose token already trades, kept aside to calibrate peer multiples"
: STATE.rows.length + " pre-token protocols ranked by implied FDV - all " + covered + " watchlist protocols covered";
var ribbon = route.tab === "live"
? '<div class="ribbon">Market caps from the snapshot, not ranked as launches. ' + STATE.onRecord + " rows have a symbol and no market cap, so they price nothing here.</div>"
: renderFormulaRibbon(shown[0]);
return renderHeader() + '<h2 class="headline">' + esc(headline) + "</h2>" + renderKpis() + ribbon +
renderFilters(route, shown.length, base.length) +
'<div class="workspace">' + (route.tab === "live" ? renderTokenTradesTable(shown, route) : renderBoardTable(shown, route)) +
renderRail(shown, route) + "</div>";
}
function findRow(slug) {
for (var i = 0; i < STATE.rows.length; i++) if (STATE.rows[i].slug === slug) return STATE.rows[i];
return null;
}
function findLive(slug) {
for (var i = 0; i < STATE.live.length; i++) if (STATE.live[i].slug === slug) return STATE.live[i];
return null;
}
function renderValueWaterfall(row) {
var tvl = row.tvl_usd;
var afterPeer = tvl * row.peer_multiple;
var afterGrowth = afterPeer * row.growth_factor;
var afterRunway = afterGrowth * row.runway_factor;
var max = Math.max(tvl, afterPeer, afterGrowth, afterRunway, row.implied_value_usd);
function bar(v) {
var w = max > 0 ? Math.max(6, Math.round(100 * v / max)) : 0;
return '<div class="bar"><i style="width:' + w + '%"></i></div>';
}
var stages = [
["TVL", formatUsdCompact(tvl), "deposits today", bar(tvl), ""],
["× " + formatFactor(row.peer_multiple) + " peer", formatUsdCompact(afterPeer), catOf(row) + " · n=" + row.peer_n + " · weight " + formatFactor(row.peer_weight), bar(afterPeer), ""],
["× " + formatFactor(row.growth_factor) + " growth", formatUsdCompact(afterGrowth), row.growth_note ? "7d unreported, factor 1" : formatPct(row.change_7d) + " over 7 days", bar(afterGrowth), ""],
["× " + formatFactor(row.runway_factor) + " runway", formatUsdCompact(afterRunway), row.runway_note ? "listed_at unreported, factor 0.9" : formatAge(row.age_days) + " token-free", bar(afterRunway), ""],
["× " + formatFactor(row.class_discount) + " class", formatUsd(row.implied_value_usd), row.launch_class + ", rounded", bar(row.implied_value_usd), " final"]
];
var html = '<div class="falls" aria-label="Value waterfall">';
for (var i = 0; i < stages.length; i++) {
var s = stages[i];
html += '<div class="stage' + s[4] + '"><div class="k">' + esc(s[0]) + '</div><div class="v num">' + esc(s[1]) + "</div>" + s[3] + '<div class="n">' + esc(s[2]) + "</div></div>";
}
return html + "</div>";
}
function renderFarmPlan(row) {
var plan = row.plan;
var html = '<section class="card"><h2>Farm plan · ' + esc(plan.chain) + " · ticket " + formatUsd(plan.ticket_usd) + "</h2>";
html += '<p class="note">Ticket sizing: $500 under $25M TVL, $1,000 under $100M, $2,500 under $500M, $5,000 above. Gas is a planning estimate. The ticket stays your capital.</p><ol class="steps">';
for (var i = 0; i < plan.steps.length; i++) {
var step = plan.steps[i];
var cost = step.cost_usd > 0 ? formatUsd(step.cost_usd) : "no fee";
html += '<li><div class="n">' + (i + 1) + '</div><div><div class="t">' + esc(step.title) + '</div><div class="d">' + esc(step.detail) +
'</div></div><div class="c"><span class="num">' + cost + "</span><br>" + step.minutes + " min</div></li>";
}
var t = plan.totals;
html += '</ol><div class="totals"><div><span>Cash cost</span><b class="num">' + formatUsd(t.cash_usd) + '</b></div><div><span>Hands-on</span><b class="num">' +
t.minutes + ' min</b></div><div><span>Hold</span><b class="num">' + t.hold_days + ' days</b></div><div><span>Opportunity, 5% APR</span><b class="num">' +
formatUsd(t.opp_usd) + "</b></div></div></section>";
return html;
}
function peersFor(row) {
var cat = catOf(row);
var list = [];
for (var i = 0; i < STATE.live.length; i++) if (catOf(STATE.live[i]) === cat) list.push(STATE.live[i]);
list.sort(function (a, b) {
if (a.tvl_usd !== b.tvl_usd) return b.tvl_usd - a.tvl_usd;
if (a.slug < b.slug) return -1;
if (a.slug > b.slug) return 1;
return 0;
});
return list.slice(0, 5);
}
function renderPeers(row) {
var list = peersFor(row);
var html = "<h2>Category peers whose token trades</h2>";
if (!list.length) return html + '<p class="note">No trading peer in this category, so the multiple is the field median.</p>';
html += '<table class="mini"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Mcap/TVL</th></tr></thead><tbody>';
for (var i = 0; i < list.length; i++) {
var p = list[i];
html += "<tr><td>" + esc(p.name) + '</td><td class="num">' + formatUsdCompact(p.tvl_usd) + '</td><td class="num">' + formatUsdCompact(p.mcap_usd) + '</td><td class="num">' + formatFactor(p.multiple) + "×</td></tr>";
}
return html + "</tbody></table>";
}
function renderNeighbours(row) {
var html = "<h2>Neighbours on the board</h2>";
for (var i = 0; i < STATE.rows.length; i++) {
var r = STATE.rows[i];
if (Math.abs(r.rank - row.rank) > 2) continue;
var label = "#" + r.rank + " " + esc(r.name);
var val = '<span class="num">' + formatUsdCompact(r.implied_value_usd) + "</span>";
if (r.slug === row.slug) html += '<div class="nb"><span class="here">' + label + "</span>" + val + "</div>";
else html += '<a class="nb" href="#/p/' + encodeURIComponent(r.slug) + '"><span>' + label + "</span>" + val + "</a>";
}
return html;
}
function renderDetail(route) {
var row = findRow(route.slug);
var back = '<a class="back" href="#' + esc(lastBoard) + '">Back to board</a>';
if (!row) {
var live = findLive(route.slug);
if (!live) return renderHeader() + '<div class="detail">' + back + '<h2 class="headline">No protocol with this slug is in the snapshot.</h2></div>';
return renderHeader() + '<div class="detail">' + back +
'<div class="hero"><div><h2>' + esc(live.name) + '</h2><div class="rowline"><span class="badge derivative">Token trades</span> ' +
esc(catOf(live)) + " · " + esc(live.symbol || "") + " · " + esc(chainLabel(live.chains, 4)) +
'</div></div><div class="hero-val"><div class="big num">' + formatUsdCompact(live.mcap_usd) + '</div><div class="full">market cap · mcap/TVL ' +
formatFactor(live.multiple) + "× · TVL " + formatUsdCompact(live.tvl_usd) + '</div><div class="per">This token already trades, so it stays off the ranked board and inside calibratePeerMultiples. Its mcap/TVL is one input to the ' + esc(catOf(live)) + " peer multiple.</div></div></div></div>";
}
var status = row.token_status === "pre-token" ? "records no token" : row.token_status;
return renderHeader() + '<div class="detail">' + back +
'<div class="hero"><div><h2><span class="rankchip num">#' + row.rank + "</span>" + esc(row.name) + '</h2><div class="rowline"><span class="badge ' +
row.launch_class + '">' + capClass(row.launch_class) + "</span> " + esc(catOf(row)) + " · " + status + " · " +
esc(chainLabel(row.chains, 4)) + '</div></div><div class="hero-val"><div class="big num">' + formatUsdCompact(row.implied_value_usd) +
'</div><div class="full num">' + formatUsd(row.implied_value_usd) + ' implied FDV</div><div class="per"><b class="num">' + formatUsd(row.airdrop_per_1k) +
"</b> per $1,000 if 10% of this FDV were shared pro rata with TVL. Illustration, not a promised airdrop.</div></div></div>" +
renderValueWaterfall(row) + '<div class="detail-grid">' + renderFarmPlan(row) +
'<section class="card"><p class="note">' + esc(TokenRadar.explainLaunchClass(row, STATE.snap.watchlist, STATE.snap.floor_usd)) + "</p>" +
renderPeers(row) + renderNeighbours(row) + "</section></div></div>";
}
function clipWholeRows() {
var w = document.querySelector(".table-wrap");
if (!w) return;
var h = w.querySelector("thead"), r = w.querySelector("tbody tr");
if (!h || !r || !r.offsetHeight) return;
var n = Math.floor((w.clientHeight - h.offsetHeight) / r.offsetHeight);
if (n < 1) return;
w.style.height = (h.offsetHeight + n * r.offsetHeight) + "px";
}
function render() {
var route = parseRoute();
document.getElementById("app").innerHTML = route.view === "detail" ? renderDetail(route) : renderBoard(route);
clipWholeRows();
if (!restoreSearch) return;
var el = document.getElementById("q");
if (el) {
el.focus();
var n = el.value.length;
try { el.setSelectionRange(n, n); } catch (err) {}
}
restoreSearch = false;
}
function onClick(e) {
var t = e.target.closest("[data-act]");
if (t) {
var act = t.getAttribute("data-act");
var route = parseRoute();
if (act === "tab") {
route.tab = t.getAttribute("data-tab");
route.view = "board";
route.cls = "all";
route.sort = route.tab === "live" ? "mcap" : "rank";
route.dir = route.tab === "live" ? "desc" : "asc";
} else if (act === "class") {
route.cls = t.getAttribute("data-class");
} else if (act === "sort") {
var key = t.getAttribute("data-key");
if (route.sort === key) route.dir = route.dir === "asc" ? "desc" : "asc";
else { route.sort = key; route.dir = preferredDir(key); }
} else if (act === "clear") {
var k = t.getAttribute("data-key");
if (k === "class") route.cls = "all";
else route[k] = "";
} else if (act === "reset") {
location.hash = route.tab === "live" ? "/?tab=live" : "/";
return;
}
location.hash = buildHash(route);
return;
}
var row = e.target.closest("tr[data-slug]");
if (row && !e.target.closest("a,button")) location.hash = "/p/" + encodeURIComponent(row.getAttribute("data-slug"));
}
function onChange(e) {
var id = e.target.id;
if (id !== "cat" && id !== "chain" && id !== "minTvl") return;
var route = parseRoute();
route[id === "minTvl" ? "minTvl" : id] = e.target.value;
location.hash = buildHash(route);
}
function onInput(e) {
if (!e.target || e.target.id !== "q") return;
restoreSearch = true;
var route = parseRoute();
route.q = e.target.value;
var next = "#" + buildHash(route);
if (location.hash !== next) history.replaceState(null, "", next);
render();
}
function boot() {
var snap = window.RADAR_SNAPSHOT;
if (!snap || !window.TokenRadar || typeof TokenRadar.rankBoard !== "function") {
document.getElementById("app").textContent = "Missing snapshot or model.";
return;
}
var ranked = TokenRadar.rankBoard(snap);
STATE.snap = snap;
STATE.rows = ranked.rows;
STATE.live = TokenRadar.tokenTradesTable(snap);
STATE.peers = ranked.peers;
STATE.summary = TokenRadar.modelSummary();
STATE.onRecord = ranked.token_on_record;
for (var i = 0; i < STATE.rows.length; i++) STATE.rows[i].plan = TokenRadar.buildFarmPlan(STATE.rows[i], { as_of: snap.as_of });
window.addEventListener("hashchange", render);
document.body.addEventListener("click", onClick);
document.body.addEventListener("change", onChange);
document.body.addEventListener("input", onInput);
render();
}
boot();
