// Capture the three judge screenshots from the built dashboard.
// node tools/capture.mjs

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "out/capture");
const shots = resolve(root, "screenshots");
mkdirSync(shots, { recursive: true });

const build = spawnSync(process.execPath, [
  resolve(root, "main.ts"),
  "--input", resolve(root, "_kit/input/snapshot.json"),
  "--output", outDir,
  "--skip-dossier",
], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const board = JSON.parse(readFileSync(resolve(outDir, "board.json"), "utf8"));
let detail = board.rows[0].slug;
for (const row of board.rows) {
  if (row.rank <= 5 && row.on_watchlist) {
    detail = row.slug;
    break;
  }
}

const page = "file://" + resolve(outDir, "dashboard/index.html");
const views = [
  ["1-board.png", "#/"],
  ["2-detail.png", "#/p/" + encodeURIComponent(detail)],
  ["3-filtered.png", "#/?class=watchlist&chain=Ethereum&sort=growth&dir=desc"],
];

for (const [name, hash] of views) {
  const dest = resolve(shots, name);
  const run = spawnSync("/usr/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    // Headless Chrome's layout viewport is 87px shorter than --window-size.
    "--window-size=1440,987",
    "--virtual-time-budget=3000",
    "--screenshot=" + dest,
    page + hash,
  ], { stdio: "inherit" });
  if (run.status !== 0) {
    process.stderr.write("chrome failed for " + name + "\n");
    process.exit(run.status ?? 1);
  }
}

const pillow = spawnSync("python3", ["-c", `
from PIL import Image
import os, sys
shots, names = sys.argv[1], sys.argv[2].split(",")
total = 0
for name in names:
    path = os.path.join(shots, name)
    im = Image.open(path).convert("RGB")
    if im.size != (1440, 900):
        cropped = im.crop((0, 0, min(im.size[0], 1440), min(im.size[1], 900)))
        canvas = Image.new("RGB", (1440, 900), (11, 16, 32))
        canvas.paste(cropped, (0, 0))
        im = canvas
    im.save(path, optimize=True)
    size = os.path.getsize(path)
    if size > 330 * 1024:
        im.quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
        size = os.path.getsize(path)
    total += size
    print(name, Image.open(path).size, size)
print("total", total)
`, shots, views.map((v) => v[0]).join(",")], { stdio: "inherit" });
if (pillow.status !== 0) process.exit(pillow.status ?? 1);
process.stdout.write("captured detail " + detail + "\n");
