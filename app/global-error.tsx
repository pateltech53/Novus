"use client";

import { useEffect } from "react";

/**
 * The last boundary: a throw in the root layout itself.
 *
 * This one REPLACES `app/layout.tsx`, which means none of the app exists around
 * it — no `globals.css` (it is imported by the layout that just failed), so no
 * tokens, no font variables, no theme attribute, no `--bg`. Every style here is
 * therefore inline and literal, and the two colours are the raw values of
 * `THEME_COLOR_DARK` / `THEME_COLOR_LIGHT` from `lib/brand.ts` rather than
 * imports — a module import is one more thing that can be the reason we are
 * here.
 *
 * That is also why it does not import `isNative()`: `/boot.html` exists only in
 * the shipped app bundle, and probing for the Capacitor global inline is
 * cheaper than trusting a module graph that has already thrown once.
 *
 * If this screen is ever seen, something is wrong at a level where the only
 * honest offer is a full reload.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[novus] root layout error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* The same two grounds native/boot.html paints, for the same reason:
            whatever shows here must not flash a different colour than the app. */}
        <style>{`
          html { background:#f6f7f9; color:#1c1d21; }
          @media (prefers-color-scheme: dark) {
            html { background:#1c1d21; color:#f6f7f9; }
          }
          body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        `}</style>
      </head>
      <body>
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.5rem",
            padding: "0 1.5rem",
            textAlign: "center",
          }}
        >
          <div>
            <p
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.18em",
                opacity: 0.55,
                margin: 0,
              }}
            >
              NOVUS COULD NOT START
            </p>
            <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.375rem", fontWeight: 800 }}>
              Something failed before the app loaded.
            </h1>
            <p
              style={{
                margin: "0.5rem auto 0",
                maxWidth: "22rem",
                fontSize: "0.875rem",
                lineHeight: 1.4,
                opacity: 0.7,
              }}
            >
              Your saved company is untouched — it lives on this device, not in
              this screen. Reloading is safe.
            </p>
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.625rem", width: "min(20rem, 100%)" }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                height: "3.5rem",
                borderRadius: "999px",
                border: "none",
                background: "#FF6B00",
                color: "#fff",
                fontSize: "1rem",
                fontWeight: 800,
                letterSpacing: "0.04em",
              }}
            >
              RELOAD ▸
            </button>
            <button
              type="button"
              onClick={() => {
                const native =
                  typeof window !== "undefined" &&
                  !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
                    ?.isNativePlatform?.();
                window.location.href = native ? "/boot.html" : "/";
              }}
              style={{
                height: "3rem",
                borderRadius: "999px",
                border: "none",
                background: "transparent",
                color: "inherit",
                opacity: 0.7,
                fontSize: "0.875rem",
                fontWeight: 700,
              }}
            >
              Back to the front door
            </button>
          </div>

          {error.digest ? (
            <p style={{ fontSize: "0.75rem", opacity: 0.5, margin: 0 }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
