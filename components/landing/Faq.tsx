import { FAQ } from "@/lib/seo";

/**
 * The questions people actually ask before they play.
 *
 * ── Why this section exists ─────────────────────────────────────────────────
 *
 * Two reasons, and the first one is the real one.
 *
 * A visitor who has heard the name and nothing else arrives wanting to know
 * what this is, whether it costs anything, and — because it asks a teenager to
 * turn on a camera — what happens to the video. Those answers were spread
 * across the page or only in the privacy policy. Someone deciding whether to
 * start should not have to read a policy to find out we never upload their
 * face.
 *
 * Second: these are the phrasings a search engine sees for the brand — "what is
 * novus", "is novus pitch free", "who made novus". Answering them in visible
 * text, marked up as an FAQPage, is what earns the expanded result under the
 * main listing.
 *
 * The answers live in lib/seo.ts because the page renders them and the JSON-LD
 * quotes them. Google requires the marked-up answer to be the one on the page,
 * and two copies of an answer is how that stops being true.
 */
export function Faq() {
  return (
    <section
      id="faq"
      aria-label="Common questions"
      className="scroll-mt-6 border-t border-[var(--hairline)]"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:px-10 lg:py-24">
        <h2 className="text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em] lg:text-[1.875rem]">
          Questions people ask.
        </h2>

        <dl className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt className="text-base font-extrabold leading-snug">
                {item.q}
              </dt>
              <dd className="mt-2 max-w-[34rem] text-sm leading-relaxed text-[var(--text-secondary)]">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
