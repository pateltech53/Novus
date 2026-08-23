#!/usr/bin/env node
/**
 * Turn the two source pictures into the assets /islands actually ships.
 *
 *   npm run art
 *
 * ── Why the sources cannot be used as they arrive ───────────────────────────
 *
 * `island.png` has **no alpha channel**. What looks like transparency is a
 * light-grey checkerboard painted into the pixels, so dropping it into the page
 * puts every island on a grey tile. It has to be keyed out — and keyed by
 * CONNECTIVITY rather than by colour, because the island wears a white foam
 * ring that a naive "remove near-white" pass eats along with the background.
 *
 * `ocean.png` puts its horizon a third of the way down. The picker floats
 * islands from near the top of the field, so used as-is, half the archipelago
 * would be in the sky. The sky is cropped back here rather than in CSS so the
 * asset itself carries the composition and nothing downstream has to know.
 *
 * ── And why the briefcase is generated eight times ──────────────────────────
 *
 * The briefcase is what tells two companies apart on the water. In a drawing
 * that was one variable; in a photograph it is a fixed slab of grey. Recolouring
 * a raster region in the browser means a filter over the WHOLE image — which
 * would take the palm and the sand with it — so the variants are cut here, once,
 * at build time. Eight files of ~12 KB each, and the page just picks one.
 *
 * The recolour preserves the original's shading: every briefcase pixel keeps its
 * own luminance and is retinted toward the target, so the lid stays lighter than
 * the body and the gold clasp — which is saturated, and therefore never in the
 * mask — stays gold.
 *
 * Sources live in assets-src/ and are tracked. Outputs are generated and
 * versioned in the filename, because next.config.ts serves /islands immutable.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The whole job is pixel work, and Node has no image primitives. Python with
 * Pillow is already how `make-icons.mjs` and `make-app-icons.mjs` do theirs, so
 * this follows the house pattern rather than adding an npm image toolchain for
 * one script that runs when the art changes.
 */
const PY = String.raw`
import sys, json
from collections import deque
from PIL import Image
import numpy as np

root = sys.argv[1]
out = {}

# ── 1 · the island, keyed ────────────────────────────────────────────────────
src = Image.open(f"{root}/assets-src/island.png").convert("RGB")
im = np.asarray(src).astype(np.int16)
h, w, _ = im.shape
mx, mn = im.max(2), im.min(2)

# The checkerboard: two greys, both very light and both neutral. Generous on
# lightness and tight on neutrality, because the foam ring is white but the
# SAND beside it is not, and the ring is saved by connectivity below rather
# than by this test.
bg_like = (mx >= 232) & ((mx - mn) <= 8)

# Flood from the border. A white pixel INSIDE the island — the foam, the
# highlight on the water — is never reached, which is the whole reason this is
# a fill and not a threshold.
seen = np.zeros((h, w), dtype=bool)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if bg_like[y, x] and not seen[y, x]:
            seen[y, x] = True; q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if bg_like[y, x] and not seen[y, x]:
            seen[y, x] = True; q.append((y, x))
while q:
    y, x = q.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and bg_like[ny, nx] and not seen[ny, nx]:
            seen[ny, nx] = True; q.append((ny, nx))

alpha = np.where(seen, 0, 255).astype(np.uint8)

# The edge pixels are the source blended against the checkerboard, so a hard
# 0/255 alpha leaves a pale fringe. One pass of "if most of my neighbours are
# background, I am partly background" softens it without eating the silhouette.
a = alpha.astype(np.float32) / 255.0
pad = np.pad(a, 1, mode="edge")
neigh = (pad[:-2,1:-1] + pad[2:,1:-1] + pad[1:-1,:-2] + pad[1:-1,2:] + a * 4) / 8.0
alpha = np.clip(np.where(a > 0, neigh, 0.0) * 255, 0, 255).astype(np.uint8)

rgba = np.dstack([im.astype(np.uint8), alpha])

# Trim to the drawing, so the glyph's box is the island and not the margin the
# render happened to leave around it.
ys, xs = np.nonzero(alpha > 8)
top, bot, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
rgba = rgba[top:bot, left:right]
out["trim"] = [int(left), int(top), int(right), int(bot)]

# ── 2 · the briefcase, isolated ──────────────────────────────────────────────
# Dark and near-neutral. The palm's bark is dark but warm, the coconuts likewise,
# and the gold clasp is saturated — none of them pass. The fill from a seed
# inside the body then keeps it to the case itself rather than to every dark
# neutral pixel in the picture, of which the frond shadows are the rest.
sub = rgba[..., :3].astype(np.int16)
sh, sw, _ = sub.shape
smx, smn = sub.max(2), sub.min(2)
case_like = (smx < 132) & ((smx - smn) < 34) & (rgba[..., 3] > 200)

seed_y, seed_x = 720 - int(top), 510 - int(left)
if not case_like[seed_y, seed_x]:
    raise SystemExit("briefcase seed missed — the source art moved")

case = np.zeros((sh, sw), dtype=bool)
case[seed_y, seed_x] = True
q = deque([(seed_y, seed_x)])
while q:
    y, x = q.popleft()
    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < sh and 0 <= nx < sw and case_like[ny, nx] and not case[ny, nx]:
            case[ny, nx] = True; q.append((ny, nx))
out["case_px"] = int(case.sum())

# ── 3 · the variants ─────────────────────────────────────────────────────────
SIZE = 512
PALETTE = json.loads(sys.argv[2])

def emit(img, name):
    im2 = Image.fromarray(img, "RGBA")
    im2.thumbnail((SIZE, SIZE), Image.LANCZOS)
    im2.save(f"{root}/public/islands/{name}", "WEBP", quality=90, method=6)

lum = sub.sum(2) / 3.0

for i, hexcol in enumerate(PALETTE):
    tr, tg, tb = (int(hexcol[k:k+2], 16) for k in (1, 3, 5))
    tl = (tr + tg + tb) / 3.0
    tinted = rgba.copy()
    # Keep each pixel's own brightness, take the target's hue: scale the target
    # by how light this pixel is relative to the case's mean. Clipped, so a
    # highlight on a dark case cannot blow out to white.
    scale = (lum / max(lum[case].mean(), 1.0))[..., None]
    tint = np.clip(np.array([tr, tg, tb], dtype=np.float32) * scale, 0, 255)
    for c in range(3):
        tinted[..., c] = np.where(case, tint[..., c].astype(np.uint8), tinted[..., c])
    emit(tinted, f"island-{i}.webp")

# The ended island: colour drained, and darker, because a company that went
# under should read as such at 36px without needing a symbol on top of it.
grey = np.repeat((lum * 0.82).clip(0, 255).astype(np.uint8)[..., None], 3, axis=2)
ended = np.dstack([grey, rgba[..., 3]])
emit(ended, "island-ended.webp")

# ── 4 · the ocean, recomposed ────────────────────────────────────────────────
# The horizon is found rather than measured by eye: it is the row where the
# picture stops being sky-pale and starts being water-blue, which shows up as
# the largest single jump in mean row brightness.
sea = Image.open(f"{root}/assets-src/ocean.png").convert("RGB")
sa = np.asarray(sea).astype(np.float32)
rows = sa.mean(axis=(1, 2))
band = rows[: int(len(rows) * 0.7)]
horizon = int(np.argmin(np.diff(band)) + 1)
out["horizon"] = horizon

# Crop the sky back so the horizon lands at HORIZON_PCT of the finished image.
# The clouds sit just under the top of the frame, so cropping from the TOP is
# what keeps them: it removes empty gradient first.
HORIZON_PCT = 0.24
water = sa.shape[0] - horizon
sky_keep = int(round(water * HORIZON_PCT / (1 - HORIZON_PCT)))
top_cut = max(0, horizon - sky_keep)
out["sky_cut"] = top_cut
ocean = sea.crop((0, top_cut, sea.width, sea.height))
ocean.thumbnail((1280, 1280), Image.LANCZOS)
ocean.save(f"{root}/public/islands/ocean.webp", "WEBP", quality=86, method=6)
out["ocean"] = list(ocean.size)
out["horizon_pct"] = round((horizon - top_cut) / (sea.height - top_cut), 4)

print(json.dumps(out))
`;

/**
 * The eight briefcases.
 *
 * The same eight the drawn glyph used, as hex — leathers, canvases and hard
 * cases a real briefcase is made in, rather than a hue rotation that would put
 * an acid-green one on somebody's front door. Index 0 is the source art's own
 * graphite, so island-0 is the picture as delivered.
 */
const CASE_HEX = [
  "#3f4247", // graphite — the original
  "#7a5230", // tan leather
  "#6d2f2c", // oxblood
  "#2f4470", // navy
  "#2f5a45", // racing green
  "#5c5a34", // olive canvas
  "#4a3358", // aubergine
  "#4d6272", // steel
];

const report = execFileSync("python3", ["-c", PY, root, JSON.stringify(CASE_HEX)], {
  encoding: "utf8",
  maxBuffer: 1 << 24,
});
const r = JSON.parse(report.trim().split("\n").pop());

console.log(`island   trimmed to ${r.trim[2] - r.trim[0]}×${r.trim[3] - r.trim[1]}`);
console.log(`         briefcase ${r.case_px.toLocaleString()} px, ${CASE_HEX.length} variants + ended`);
console.log(`ocean    horizon found at row ${r.horizon}, cropped ${r.sky_cut} from the top`);
console.log(`         ${r.ocean[0]}×${r.ocean[1]}, horizon now at ${(r.horizon_pct * 100).toFixed(1)}%`);

if (r.case_px < 20_000) {
  console.log("\n✗ the briefcase mask is suspiciously small — check island-0.webp before shipping");
  process.exit(1);
}
