/**
 * A small boat, with the small print in it.
 *
 * ── Why the copy is in a boat ──────────────────────────────────────────────
 *
 * The picker's water goes edge to edge, which leaves the two sentences that
 * are not islands — how many you may hold, and what Pro adds — with nowhere to
 * be. A panel would put a rectangle back on a screen whose whole idea is that
 * there are no rectangles; unbacked text floating on the waves is unreadable
 * the moment a swell passes under it.
 *
 * So it gets a hull. The boat is a legibility surface first — an opaque fill
 * under the type, which is what the text needed — and it happens to belong to
 * the scene, which is what stops it reading as a tooltip that drifted in.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────
 *
 * The hull stretches to whatever the text needs (`preserveAspectRatio="none"`)
 * and the mast does not — a pennant that stretched with a long sentence would
 * be a smear. They are two elements for that reason alone.
 *
 * Content by design.md's reckoning, so: opaque, one hairline, no glass. It
 * carries no figure, but it is not a control either — nothing in it is
 * tappable except the link the caller may put inside.
 *
 * The caller adds `.nv-bob`, so the boat rides the same swell the islands do.
 * It is the one thing on the water that would look wrong sitting still.
 */
export function Boat({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* Mast and pennant, drawn above the hull and never stretched. */}
      <svg
        width="26"
        height="30"
        viewBox="0 0 26 30"
        fill="none"
        aria-hidden
        className="absolute -top-[27px] left-1/2 -translate-x-1/2"
      >
        <path
          d="M8 30 V3"
          stroke="var(--text-tertiary)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path d="M9 4 L22 9 L9 14 Z" fill="var(--text-tertiary)" opacity="0.55" />
      </svg>

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 200 80"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden
      >
        {/* Hull: wide at the gunwale, curved along the keel. One shape — a
            deck line across the top read as a strikethrough over the type. */}
        <path
          d="M1 1 H199 L181 54 Q100 80 19 54 Z"
          fill="var(--surface)"
          stroke="var(--hairline)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* The padding is asymmetric on purpose: the hull narrows toward the
          keel, so text sitting centred in the box would overhang it at the
          bottom. It sits in the beam, where the boat is widest. */}
      <div className="relative px-8 pt-3 pb-7 text-center">{children}</div>
    </div>
  );
}
