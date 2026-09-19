"use client";
import { useEffect, useState, useCallback } from "react";
import {
  competitionRequest,
  syncSavedCompetitionScores,
} from "@/lib/competitions/client";
import type { Competition, Board } from "@/lib/competitions/types";
import { prizeLabel } from "@/lib/competitions/rules";
import { fmtMoney } from "@/lib/engine/format";
import { appPath } from "@/lib/native/href";
import { AdminTable, AdminCell } from "@/components/admin/table";
export const field =
  "min-h-11 w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-[var(--n-2)] px-3 py-2 text-sm";
export const button =
  "min-h-11 rounded-[var(--radius-row)] border border-[var(--hairline)] px-4 py-2 text-sm font-bold disabled:opacity-40";
export const primary = button + " bg-[var(--text-primary)] text-[var(--n-1)]";
export function CompetitionList({
  chapterId,
  refreshKey = 0,
}: {
  chapterId?: string;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<Competition[] | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.error) setSyncNote(detail.error);
      else if (detail.count) setSyncNote("Your verified score is synced.");
      else setSyncNote("Saved company checked: no eligible live competition.");
    };
    window.addEventListener("novus:competition-sync", handle);
    return () => window.removeEventListener("novus:competition-sync", handle);
  }, []);
  const query = chapterId ? `chapterId=${chapterId}&` : "";
  const load = useCallback(async () => {
    try {
      const d = await competitionRequest(`/api/competitions?${query}`);
      setItems(d.competitions);
      setOffset(Date.parse(d.serverNow) - Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const read = async () => {
      try {
        const d = await competitionRequest(
          `/api/competitions?${query}id=${selected}`,
        );
        if (alive) setBoard(d.board ?? null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void read();
    const t = setInterval(() => void read(), 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected, query]);
  const join = async (id: string) => {
    setBusy(true);
    try {
      await competitionRequest("/api/competitions", { action: "join", id });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Enterprise competitions">
      {syncNote && (
        <p role="status" className="my-3 text-sm text-[var(--text-secondary)]">
          {syncNote}
        </p>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-[var(--alert)]">
          {error}{" "}
          <button className={button} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {items === null && !error && (
        <p role="status" className="py-6 text-sm">
          Loading competitions…
        </p>
      )}
      {items?.length === 0 && (
        <p className="py-6 text-sm text-[var(--text-secondary)]">
          {chapterId
            ? "Create the first competition for your students."
            : "Your enterprise has no competitions for you yet."}
        </p>
      )}
      <div className="divide-y divide-[var(--hairline)]">
        {items?.map((c) => {
          const upcoming = now < Date.parse(c.starts_at),
            ended = now >= Date.parse(c.ends_at);
          const ms = Math.max(
            0,
            Date.parse(upcoming ? c.starts_at : c.ends_at) - now,
          );
          const time = `${Math.floor(ms / 86400000)}d ${Math.floor(ms / 3600000) % 24}h ${Math.floor(ms / 60000) % 60}m ${Math.floor(ms / 1000) % 60}s`;
          return (
            <article key={c.id} className="py-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[var(--color-prestige)]">
                    {c.cancelled_at
                      ? "CANCELLED"
                      : c.settled_at
                        ? "RESULTS FINAL"
                        : ended
                          ? "AWARDING PRIZES"
                          : upcoming
                            ? "UPCOMING"
                            : "LIVE COMPETITION"}
                  </p>
                  <h3 className="mt-2 text-xl font-extrabold">{c.title}</h3>
                </div>
                {!ended && !c.cancelled_at && (
                  <p className="tnum text-sm font-bold">
                    {upcoming ? "Starts in" : "Ends in"} {time}
                  </p>
                )}
              </div>
              {c.description && (
                <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                  {c.description}
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--text-secondary)]">
                {new Date(c.starts_at).toLocaleString()} –{" "}
                {new Date(c.ends_at).toLocaleString()} ·{" "}
                {c.enrollment === "automatic"
                  ? "Automatic entry"
                  : "Sign-up required"}
              </p>
              <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {[...c.competition_prizes]
                  .sort((a, b) => a.place - b.place)
                  .map((p) => (
                    <li key={p.place}>
                      <strong>#{p.place}</strong> {prizeLabel(p)}
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                New companies only. Your highest verified valuation wins. Scores
                must sync before the deadline. Equal scores go to the first
                received.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {!chapterId &&
                  !ended &&
                  !c.cancelled_at &&
                  (c.enrollment === "automatic" || c.joinedAt ? (
                    !upcoming ? (
                      <a className={primary} href={appPath("/found")}>
                        Create a new company
                      </a>
                    ) : (
                      <span className="self-center text-sm">
                        Create your company when the competition starts.
                      </span>
                    )
                  ) : (
                    <button
                      disabled={busy}
                      className={primary}
                      onClick={() => void join(c.id)}
                    >
                      Join competition
                    </button>
                  ))}
                <button
                  className={button}
                  aria-expanded={selected === c.id}
                  onClick={() => {
                    setBoard(null);
                    setSelected(selected === c.id ? null : c.id);
                  }}
                >
                  Leaderboard
                </button>
                {!chapterId && !upcoming && !ended && (
                  <button
                    className={button}
                    onClick={async () => {
                      setSyncNote("Syncing your saved companies…");
                      try {
                        if (!(await syncSavedCompetitionScores()))
                          setSyncNote("No new saved score to sync.");
                      } catch (e) {
                        setSyncNote((e as Error).message);
                      }
                    }}
                  >
                    Sync my score
                  </button>
                )}
              </div>
              {selected === c.id && (
                <div className="mt-4">
                  {!board ? (
                    <p role="status">Loading leaderboard…</p>
                  ) : (
                    <>
                      <p className="text-sm">
                        {board.yourRank
                          ? `Your rank: #${board.yourRank}`
                          : "No verified score from you yet."}{" "}
                        · {board.rankedCount} ranked students
                      </p>
                      {board.yourPrize && (
                        <p role="status" className="mt-2 font-bold">
                          Awarded: {prizeLabel(board.yourPrize)}.{" "}
                          {board.yourPrize.kind === "chest" ? (
                            <a href={appPath("/rewards")} className="underline">
                              Open your vault
                            </a>
                          ) : (
                            "Your run tickets are ready."
                          )}
                        </p>
                      )}
                      {board.leaders.length ? (
                        <AdminTable
                          label="Competition leaderboard"
                          columns={["Rank", "Student", "Company", "Peak value"]}
                          numericColumns={["Rank", "Peak value"]}
                        >
                          {board.leaders.map((r) => (
                            <tr key={r.place}>
                              <AdminCell label="Rank" numeric>
                                #{r.place}
                              </AdminCell>
                              <AdminCell label="Student" primary>
                                {r.handle}
                                {r.isYou ? " · You" : ""}
                              </AdminCell>
                              <AdminCell label="Company">
                                {r.company_name}
                              </AdminCell>
                              <AdminCell label="Peak value" numeric>
                                {fmtMoney(r.peak_valuation)}
                              </AdminCell>
                            </tr>
                          ))}
                        </AdminTable>
                      ) : (
                        <p className="mt-3 text-sm text-[var(--text-secondary)]">
                          Create and play a new company during the competition
                          to appear here.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
