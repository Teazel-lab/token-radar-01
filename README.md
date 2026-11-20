# Token Radar

A token-launch radar for the make.fun bounty `token-radar-01`. It ranks protocols that record no token by an implied fully diluted value drawn only from the sealed snapshot, and it writes a concrete farm plan for each one.

Protocols whose token already trades are kept off the ranked board. Their market-cap-to-TVL ratios calibrate the peer multiple. A symbol with no recorded market cap is priced by neither table.

## The value

Implied FDV = TVL × peer mcap/TVL × 7-day growth × token-free runway × class discount.

The peer multiple is the category median of log(mcap/TVL), shrunk toward the field median with weight `n/(n+4)`, then exponentiated and clamped to 0.03..2.5. Growth is `exp(0.5 × clamp(7-day change, -40, 60) / 100)`. Runway is `0.8 + 0.45 × min(age, 900) / 900` UTC days from `listed_at` to `as_of`. A wrapped, staked, bridged, versioned, or exchange product is classed derivative and multiplied by 0.35. Watchlist and early protocols use 1.

Per $1,000 is an illustration: 10% of that stated FDV shared pro rata with today's TVL. It is not a promised airdrop.

`dashboard/model.js` and `dashboard/farm.js` are the only implementation. `main.ts` runs those same files with `node:vm` to write `board.json`. The page runs them again on `data.js`, so the screenshots and the board are one model.

## Run

Node 22.18 or newer. No packages.

```bash
node main.ts --input _kit/input/snapshot.json --output out
```

`--input` may be a snapshot file or a directory that contains `snapshot.json` (default `/input`). `--output` defaults to `MAKEFUN_OUTPUT_DIR` or `/output`. The run writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json`.

Open `out/dashboard/index.html` from disk. The board is `#/`, a protocol is `#/p/<slug>`, and filters live in the query, for example `#/?class=watchlist&chain=Ethereum&sort=growth&dir=desc`.

## Screenshots and checks

```bash
node tools/capture.mjs
node tools/verify.mjs
```

Capture rebuilds into `out/capture` and writes `screenshots/1-board.png`, `screenshots/2-detail.png`, and `screenshots/3-filtered.png` with headless Chrome. The window is 1440×987 because this Chrome's layout viewport is 87px shorter than the window, which lands the page on a 1440×900 shot. Verify runs `main.ts` twice and checks that the outputs match and that the gate rules hold.
