"use client";
import { useEffect, useState } from "react";
import { competitionRequest } from "@/lib/competitions/client";
import { appPath } from "@/lib/native/href";
export function CompetitionBanner() {
  const [count, setCount] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    const read = () =>
      competitionRequest("/api/competitions")
        .then((d) => {
          if (live)
            setCount(
              d.competitions.filter(
                (c: { ends_at: string; cancelled_at: string | null }) =>
                  !c.cancelled_at &&
                  Date.parse(c.ends_at) > Date.parse(d.serverNow),
              ).length,
            );
        })
        .catch(() => {});
    void read();
    const timer = setInterval(() => void read(), 60000);
    const sync = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.error)
        setNote("Score sync pending. Connect and open competitions to retry.");
      else if (d.count) setNote("Score synced.");
    };
    window.addEventListener("novus:competition-sync", sync);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("novus:competition-sync", sync);
    };
  }, []);
  if (!count) return null;
  return (
    <aside className="mx-4 my-3 rounded-[var(--radius-row)] border border-[var(--color-prestige)] bg-[var(--n-2)] p-3 text-sm">
      <a
        href={appPath("/competitions")}
        className="flex min-h-11 items-center justify-between gap-3 font-bold"
      >
        <span>
          {count} enterprise competition{count === 1 ? "" : "s"} · View prizes
          and leaderboard
        </span>
        <span aria-hidden="true">→</span>
      </a>
      {note && (
        <p role="status" className="text-xs text-[var(--text-secondary)]">
          {note}
        </p>
      )}
    </aside>
  );
}
