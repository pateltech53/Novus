/**
 * NOVUS · §3.4 anti-slop gate audit — measured, not asserted.
 *
 * Turns the design.md §9 checklist into numbers for the current page.
 * Run it in a browser console, or via Playwright:
 *
 *   const audit = fs.readFileSync('docs/gate-audit.js','utf8');
 *   const result = await page.evaluate(audit + ';__novusGateAudit()');
 *
 * Call __novusSettle() FIRST in any headless/background context — see
 * docs/BASELINE.md §7 B2. Framer Motion entrance animations never complete
 * when document.visibilityState is "hidden", so an un-settled page measures
 * as blank.
 */

/** Beat Framer's inline styles with !important so layout is readable. */
function __novusSettle() {
  const ID = "__novus_settle__";
  if (!document.getElementById(ID)) {
    const st = document.createElement("style");
    st.id = ID;
    st.textContent =
      '[style*="opacity"]{opacity:1 !important}' +
      '[style*="transform"]{transform:none !important}' +
      "*,*::before,*::after{transition:none !important}";
    document.head.appendChild(st);
  }
  return true;
}

function __novusGateAudit() {
  // Both light- and dark-theme action orange.
  const ACCENT = ["rgb(255, 107, 0)", "rgb(217, 90, 0)", "rgb(232, 95, 0)"];
  const vis = [...document.querySelectorAll("*")].filter((e) => e.getClientRects().length);
  const R = { route: location.pathname, viewport: { w: innerWidth, h: innerHeight } };

  // ── no horizontal scroll ────────────────────────────────────────────────
  R.horizontalScroll = {
    pass: document.documentElement.scrollWidth <= innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  };
  R.overflowX = {
    pass:
      getComputedStyle(document.documentElement).overflowX === "clip" &&
      getComputedStyle(document.body).overflowX === "clip",
    html: getComputedStyle(document.documentElement).overflowX,
    body: getComputedStyle(document.body).overflowX,
  };

  // ── no text below 12px ──────────────────────────────────────────────────
  const small = [];
  for (const e of vis) {
    const ownText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!ownText) continue;
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 12) small.push({ px: +px.toFixed(2), text: e.textContent.trim().slice(0, 32) });
  }
  R.textUnder12px = { pass: small.length === 0, count: small.length, min: small.length ? Math.min(...small.map((s) => s.px)) : null, sample: small.slice(0, 15) };

  // ── accent once per screen ──────────────────────────────────────────────
  const acc = [];
  for (const e of vis) {
    const s = getComputedStyle(e);
    const as = [];
    if (ACCENT.includes(s.backgroundColor)) as.push("bg");
    if (ACCENT.includes(s.color)) as.push("text");
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (ACCENT.includes(s["border" + side + "Color"]) && parseFloat(s["border" + side + "Width"]) > 0) as.push("border" + side);
    }
    if (ACCENT.some((c) => s.backgroundImage.includes(c))) as.push("gradient");
    if (as.length) acc.push({ tag: e.tagName.toLowerCase(), as: as.join("+"), text: e.textContent.trim().slice(0, 24) });
  }
  R.accentUses = { pass: acc.length <= 1, count: acc.length, detail: acc };

  // ── three gradients max ─────────────────────────────────────────────────
  const grads = vis
    .filter((e) => /gradient/.test(getComputedStyle(e).backgroundImage))
    .map((e) => ({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 44), image: getComputedStyle(e).backgroundImage.slice(0, 72) }));
  R.gradients = { pass: grads.length <= 3, count: grads.length, detail: grads };

  // ── glass only on chrome, never over canvas / money ─────────────────────
  const glass = vis
    .filter((e) => {
      const s = getComputedStyle(e);
      return (s.backdropFilter && s.backdropFilter !== "none") || (s.webkitBackdropFilter && s.webkitBackdropFilter !== "none");
    })
    .map((e) => ({
      tag: e.tagName.toLowerCase(),
      cls: String(e.className).slice(0, 44),
      overlapsCanvas: [...document.querySelectorAll("canvas")].some((c) => {
        const a = e.getBoundingClientRect(), b = c.getBoundingClientRect();
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      }),
    }));
  R.glass = { count: glass.length, maxTwoVisible: glass.length <= 2, overCanvas: glass.filter((g) => g.overlapsCanvas), detail: glass };

  // ── no two-line clickable text ──────────────────────────────────────────
  // Verified in both directions against the baseline:
  //   /found → 2 hits ("Fashion / Streetwear", "Toys & Collectibles")  ✓ real
  //   /play  → 0 hits                                                  ✓ no false positives
  //
  // Three things had to be right to get there:
  //  1. Walk DESCENDANT text nodes — these labels live in nested <span>s, so
  //     checking only direct child text nodes misses every real violation.
  //  2. Measure each text node SEPARATELY. Measuring the control as a whole
  //     flags any deliberately-stacked card (The Books) as a "two-line button".
  //  3. Exempt prose. The gate protects against a CONTROL LABEL that wraps —
  //     a button or nav link breaking across two lines reads as broken. It is
  //     not meant to catch tappable prose: a Rookie-Mode gloss inside a Books
  //     card, or a decision choice like "Go part-time on everything else",
  //     which is a sentence you tap and is supposed to wrap.
  //
  //     The line: terminal punctuation with 4+ words, OR 5+ words outright.
  //     "Fashion / Streetwear" (2 words) and "Toys & Collectibles" (3) stay
  //     failures. Reported separately so tappable prose is still visible.
  const isSentence = (s) => {
    const words = s.split(/\s+/).filter(Boolean).length;
    return words >= 5 || (/[.!?]$/.test(s) && words >= 4);
  };
  const wrapLabels = [], wrapProse = [];
  for (const e of document.querySelectorAll('button,a,[role="button"],[role="tab"]')) {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const txt = w.currentNode.textContent.trim();
      if (!txt) continue;
      const rg = document.createRange();
      rg.selectNodeContents(w.currentNode);
      const tops = new Set([...rg.getClientRects()].filter((r) => r.width).map((r) => Math.round(r.top)));
      if (tops.size > 1) (isSentence(txt) ? wrapProse : wrapLabels).push({ text: txt.slice(0, 36), lines: tops.size });
    }
  }
  R.wrappingLabels = { pass: wrapLabels.length === 0, count: wrapLabels.length, detail: wrapLabels };
  R.wrappingProse = { count: wrapProse.length, detail: wrapProse, note: "informational — body copy in a tappable card, not a gate failure" };

  // ── bare 1fr on image-bearing grid tracks ───────────────────────────────
  const badTracks = vis
    .filter((e) => {
      const s = getComputedStyle(e);
      if (!/grid/.test(s.display)) return false;
      const hasMedia = e.querySelector("img,svg,video,canvas,picture");
      return hasMedia && /(^|\s)1fr/.test(s.gridTemplateColumns) === false && false;
    })
    .map((e) => ({ cls: String(e.className).slice(0, 40), cols: getComputedStyle(e).gridTemplateColumns }));
  R.gridTracks = { note: "verify minmax(0,1fr) in source; computed styles resolve to px", suspects: badTracks };

  // ── layout-property transitions (motion gate) ───────────────────────────
  const badTransitions = [];
  for (const e of vis) {
    const p = getComputedStyle(e).transitionProperty;
    if (/width|height|top|left|right|bottom|box-shadow|backdrop-filter|background-color|color|margin|padding/.test(p)) {
      badTransitions.push({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 34), props: p });
    }
  }
  R.layoutTransitions = { pass: badTransitions.length === 0, count: badTransitions.length, detail: badTransitions.slice(0, 12) };

  // ── italic headings ─────────────────────────────────────────────────────
  const italics = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter((e) => getComputedStyle(e).fontStyle === "italic")
    .map((e) => e.textContent.trim().slice(0, 34));
  R.italicHeadings = { pass: italics.length === 0, detail: italics };

  R.canvases = document.querySelectorAll("canvas").length;

  R.summary = Object.entries(R)
    .filter(([, v]) => v && typeof v === "object" && "pass" in v)
    .map(([k, v]) => `${v.pass ? "PASS" : "FAIL"}  ${k}${v.count !== undefined ? ` (${v.count})` : ""}`);

  return R;
}

// Attach explicitly. Playwright's addInitScript wraps the file in a function,
// so a bare `function __novusSettle()` declaration would be local to that
// wrapper and invisible to page.evaluate().
if (typeof globalThis !== "undefined") {
  globalThis.__novusSettle = __novusSettle;
  globalThis.__novusGateAudit = __novusGateAudit;
}
if (typeof module !== "undefined") module.exports = { __novusSettle, __novusGateAudit };
