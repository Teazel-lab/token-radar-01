// Steps, cash, and minutes from category, chains, TVL, 7d change, and token-free age. Gas is a planning estimate. No DOM.
var GAS_CENTS = {
 "Ethereum": 450,
 "Arbitrum": 8,
 "Base": 8,
 "Optimism": 8,
 "Solana": 1,
 "Binance": 15,
 "Bitcoin": 320,
 "Tron": 110,
 "Hyperliquid L1": 5
};
var GAS_DEFAULT_CENTS = 25;
var APR = 0.05;
// [categories, title, detail, txs, weekly, minutes]. {m} ticket, {n} name, {c} chain, {w} name on chain.
var PLAYS = [
 [["Lending", "Uncollateralized Lending"], "Supply a stablecoin and borrow under 35% LTV",
  "On {w}, supply {m} USDC and borrow a stablecoin at 35% LTV or less so a 25% collateral drop does not liquidate you.", 3, false, 25],
 [["Dexs"], "Provide a balanced LP in a deep pair",
  "Add {m} as a 50/50 USDC and blue-chip pair in a deep {n} pool on {c}. Use that pool's fee tier, not an empty points pool.", 2, true, 30],
 [["Yield", "Onchain Capital Allocator", "Risk Curators", "Yield Aggregator"], "Deposit into the curated USDC vault",
  "Deposit {m} USDC into the curated USDC vault {n} offers on {c}. Read the asset list, then leave the receipt in the farm wallet.", 2, false, 20],
 [["RWA"], "Subscribe to the tokenised fund after KYC",
  "Complete {n} KYC, then subscribe {m} to the tokenised fund on {c}. Budget a business day if the issuer reviews before minting.", 1, false, 45],
 [["Derivatives", "Basis Trading", "Interest Rate Derivatives"], "Deposit margin and open a delta-neutral position",
  "Deposit {m} as margin on {w} and open a delta-neutral position (matched long and short, or basis against spot).", 2, false, 30],
 [["CDP", "CDP Manager"], "Mint the stablecoin at a 250% collateral ratio",
  "Deposit {m} of collateral into {w} and mint its stablecoin at a collateral ratio of at least 250%.", 2, false, 25],
 [["Bridge", "Canonical Bridge", "Cross Chain Bridge"], "Route a round-trip transfer",
  "Route {m} USDC across {n} to {c} and back once, on the canonical route the app quotes, from the farm wallet.", 2, true, 20],
 [["Liquid Staking", "Liquid Restaking", "Restaking", "Staking Pool", "Restaked BTC"], "Stake through the protocol's app",
  "Stake {m} of the asset {n} accepts, in its app on {c}, and keep the receipt. Do not restake that receipt elsewhere.", 2, false, 20],
 [["Chain"], "Bridge in and use two apps",
  "With {m} now on {n}, use two of its highest-TVL apps once: one swap and one deposit, then return to the starting asset.", 2, true, 25]
];
function gasCostTable() {
 var out = {};
 var names = Object.keys(GAS_CENTS).sort();
 for (var i = 0; i < names.length; i++) out[names[i]] = GAS_CENTS[names[i]] / 100;
 out._default = GAS_DEFAULT_CENTS / 100;
 return out;
}
function gasCents(chain) {
 return Object.prototype.hasOwnProperty.call(GAS_CENTS, chain) ? GAS_CENTS[chain] : GAS_DEFAULT_CENTS;
}
function usdFromCents(cents) {
 return cents / 100;
}
function pickFarmChain(chains) {
 var list = chains && chains.length ? chains : ["Ethereum"];
 var best = list[0];
 var bestGas = gasCents(best);
 for (var i = 1; i < list.length; i++) {
  var g = gasCents(list[i]);
  if (g < bestGas || (g === bestGas && list[i] < best)) {
   best = list[i];
   bestGas = g;
  }
 }
 return best;
}
// $500 under $25M TVL, $1,000 under $100M, $2,500 under $500M, $5,000 at or above.
function sizeTicket(tvl) {
 if (!(tvl >= 25000000)) return 500;
 if (tvl < 100000000) return 1000;
 if (tvl < 500000000) return 2500;
 return 5000;
}
function holdDaysFor(ageDays) {
 if (ageDays == null) return 60;
 if (ageDays < 180) return 90;
 if (ageDays < 540) return 60;
 return 30;
}
function holdWeeks(days) {
 return Math.max(1, Math.round(days / 7));
}
function opportunityCents(ticket, days) {
 return Math.round(ticket * APR * days / 365 * 100);
}
function fundRoute(chain) {
 if (chain === "Ethereum") return "transfer";
 if (chain === "Solana" || chain === "Bitcoin" || chain === "Tron" || chain === "Binance") return "withdraw";
 return "bridge";
}
function txCount(chain, evmTxs) {
 if (chain === "Solana") return Math.max(1, evmTxs - 1);
 return evmTxs;
}
function fillPlay(detail, name, chain, money) {
 var where = name + " on " + chain;
 return detail.split("{m}").join(money).split("{n}").join(name).split("{c}").join(chain).split("{w}").join(where);
}
function categoryPlaybook(row, chain, ticket) {
 var cat = row.category || "";
 var money = globalThis.TokenRadar.formatUsd(ticket);
 for (var i = 0; i < PLAYS.length; i++) {
  var p = PLAYS[i];
  if (p[0].indexOf(cat) >= 0) {
   return { title: p[1], detail: fillPlay(p[2], row.name, chain, money), txs: p[3], weekly: p[4], minutes: p[5] };
  }
 }
 return {
  title: "Deposit and use the core feature",
  detail: fillPlay("Deposit {m} into {w} and use its core feature once from the same wallet. Do not split the ticket across chains.", row.name, chain, money),
  txs: 2,
  weekly: false,
  minutes: 20
 };
}
function step(title, detail, cents, minutes, hold, opp) {
 var s = { title: title, detail: detail, cost_usd: usdFromCents(cents), minutes: minutes };
 if (hold) s.hold_days = hold;
 if (opp) s.opp_usd = usdFromCents(opp);
 return s;
}
function buildFarmPlan(row, ctx) {
 var R = globalThis.TokenRadar;
 var chain = pickFarmChain(row.chains);
 var ticket = sizeTicket(row.tvl_usd);
 var route = fundRoute(chain);
 var age = row.age_days;
 var hold = holdDaysFor(age);
 var weeks = holdWeeks(hold);
 var play = categoryPlaybook(row, chain, ticket);
 var gas = gasCents(chain);
 var money = R.formatUsd(ticket);
 var gasTxt = R.formatUsd(usdFromCents(gas));
 var openTxs = txCount(chain, play.txs);
 var steps = [];
 if (route === "transfer") {
  steps.push(step("Fund the farm wallet", "Transfer " + money + " USDC on Ethereum to a fresh farm wallet and keep $15 of ETH for gas. Planning estimate: one Ethereum transaction at " + R.formatUsd(4.5) + ".", gasCents("Ethereum"), 10));
 } else if (route === "withdraw") {
  steps.push(step("Fund the farm wallet", "Withdraw " + money + " USDC to " + chain + " from an exchange you already use, into a fresh farm wallet, and keep $5 for gas. Planning estimate: one " + chain + " transaction at " + gasTxt + ".", gas, 15));
 } else {
  steps.push(step("Fund the farm wallet", "Bridge " + money + " USDC to " + chain + " through the canonical bridge. Keep $15 of ETH for the lock and $5 for gas on " + chain + ". Planning estimate: one Ethereum lock plus one arrival.", gasCents("Ethereum") + gas, 20));
 }
 var plural = openTxs === 1 ? "" : "s";
 var openDetail = play.detail + (chain === "Solana"
  ? " Solana needs no separate approval, so this is " + openTxs + " transaction" + plural + "."
  : " That is " + openTxs + " transaction" + plural + " on " + chain + " at " + gasTxt + " each.");
 steps.push(step(play.title, openDetail, openTxs * gas, play.minutes));
 var bridgeLike = row.category === "Bridge" || row.category === "Canonical Bridge" || row.category === "Cross Chain Bridge";
 var weekTxs = play.weekly ? (bridgeLike ? 2 : 1) : 0;
 var extra = "";
 if (play.weekly && row.category === "Dexs") extra = " Each visit, swap about 1% of the ticket in the same pool and rebalance if either side is over 70%.";
 else if (play.weekly && row.category === "Chain") extra = " Each visit, use one swap and one deposit in a top app, then return to the starting asset.";
 else if (play.weekly) extra = " Each visit, send the ticket across " + row.name + " and back on the same route.";
 steps.push(step(
  "Check the position every week",
  "Over " + weeks + " weekly visits in the " + hold + "-day hold, open " + row.name + ", confirm the position is on " + chain + ", and write down TVL and the 7-day change. Each visit is about 8 minutes." + extra,
  weeks * weekTxs * gas,
  8 * weeks
 ));
 var opp = opportunityCents(ticket, hold);
 var band = age == null
  ? "listed_at is unreported, so the hold uses the middle band of 60 days"
  : "token-free runway is " + R.formatAge(age) + ", so the hold is " + hold + " days (90 under 180 days listed, 60 under 540, else 30)";
 steps.push(step(
  "Hold through the season window",
  "Leave the " + money + " position open for " + hold + " days. " + band + ". Opportunity cost at 5% APR is " + R.formatUsd(usdFromCents(opp)) + " of foregone yield, not a fee.",
  0, 5, hold, opp
 ));
 var exitLine = Math.round(row.tvl_usd * 0.75);
 var printNote = row.change_7d == null
  ? "The 7-day change is unreported, so treat the first print below -15% as the trigger."
  : "The latest 7-day print is " + R.formatPct(row.change_7d) + ".";
 var exitTxs = txCount(chain, 2);
 steps.push(step(
  "Exit if TVL or the 7-day change breaks",
  "Exit if " + row.name + " TVL falls below " + R.formatUsd(exitLine) + " (25% under today's " + R.formatUsd(row.tvl_usd) + ") or the 7-day change turns below -15%. " + printNote + " Unwind on " + chain + " and return the funds the way they arrived.",
  exitTxs * gas, 20
 ));
 var cls = row.launch_class || "early";
 var disc = row.class_discount == null ? 1 : row.class_discount;
 steps.push(step(
  "Log day one and do not buy a rumor",
  "Save the deposit transaction and day-one TVL of " + R.formatUsd(row.tvl_usd) + ". " + row.name + " records no token, so buy none. Launch class is " + cls + " and the FDV uses a class discount of " + disc + ".",
  0, 10
 ));
 return {
  steps: steps,
  totals: planTotals(steps),
  chain: chain,
  ticket_usd: ticket,
  gas_usd: usdFromCents(gas),
  weeks: weeks,
  route: route,
  hold_days: hold
 };
}
function farmStepText(step) {
 var R = globalThis.TokenRadar;
 var costBit = step.cost_usd > 0 ? "cost about " + R.formatUsd(step.cost_usd) : "no fee to pay";
 return step.title + ": " + step.detail + " - " + costBit + ", about " + step.minutes + " min";
}
function planTotals(steps) {
 var cashCents = 0;
 var minutes = 0;
 var hold = 0;
 var oppCents = 0;
 for (var i = 0; i < steps.length; i++) {
  cashCents += Math.round(steps[i].cost_usd * 100);
  minutes += steps[i].minutes;
  if (steps[i].hold_days) hold = steps[i].hold_days;
  if (steps[i].opp_usd) oppCents = Math.round(steps[i].opp_usd * 100);
 }
 return { cash_usd: cashCents / 100, minutes: minutes, hold_days: hold, opp_usd: oppCents / 100 };
}
(function () {
 var R = globalThis.TokenRadar;
 if (!R) throw new Error("farm.js: load model.js first");
 R.gasCostTable = gasCostTable;
 R.pickFarmChain = pickFarmChain;
 R.sizeTicket = sizeTicket;
 R.categoryPlaybook = categoryPlaybook;
 R.buildFarmPlan = buildFarmPlan;
 R.farmStepText = farmStepText;
 R.planTotals = planTotals;
})();
