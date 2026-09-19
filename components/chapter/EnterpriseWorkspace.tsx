"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { competitionRequest } from "@/lib/competitions/client";
import {
  CompetitionList,
  field,
  button,
  primary,
} from "@/components/competitions/CompetitionList";
import type { Student } from "@/lib/competitions/types";
import type { Prize } from "@/lib/competitions/rules";
import { AdminTable, AdminCell } from "@/components/admin/table";
import { fmtMoney } from "@/lib/engine/format";
import { appPath } from "@/lib/native/href";
import { WEB_ORIGIN } from "@/lib/native/origin";
import "@/app/admin/admin.css";

type Admin = { id: string; email: string; accepted_at: string | null };
export function EnterpriseWorkspace({
  chapterId,
  role,
  active,
  children,
}: {
  chapterId: string;
  role: "owner" | "admin";
  active: boolean;
  children: ReactNode;
}) {
  const [tab, setTab] = useState("Progress");
  const [students, setStudents] = useState<Student[]>([]);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await competitionRequest(
        `/api/chapter/progress?chapterId=${chapterId}&q=${encodeURIComponent(q)}&offset=${offset}`,
      );
      setStudents(d.students);
      setAdmins(d.admins);
      setTotal(d.total);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [chapterId, q, offset]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  const invite = async () => {
    setBusy(true);
    try {
      const d = await competitionRequest(
        `/api/chapter/admins?chapterId=${chapterId}`,
        { email },
      );
      setInviteLink(`${WEB_ORIGIN}/chapter?invite=${d.invitationId}`);
      setEmail("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await competitionRequest(
        `/api/chapter/admins?chapterId=${chapterId}`,
        { id },
        "DELETE",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-console">
      <nav aria-label="Enterprise workspaces" className="admin-nav">
        {["Progress", "Competitions", "Administrators", "Members"].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="mt-4 text-sm text-[var(--alert)]">
          {error}{" "}
          <button className={button} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {tab === "Progress" && (
        <section className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold">Student progress</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {total} students · Latest synced company data
              </p>
            </div>
            <button
              className={button}
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          <label className="mt-5 block text-sm font-bold">
            Find a student
            <input
              type="search"
              className={field + " mt-2"}
              value={q}
              placeholder="Name or email"
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          {loading && (
            <p role="status" className="mt-3 text-sm">
              Loading progress…
            </p>
          )}
          {!loading && !students.length ? (
            <p className="py-8 text-sm text-[var(--text-secondary)]">
              {q
                ? "No students match this search."
                : "Add students in Members to start tracking their progress."}
            </p>
          ) : (
            <AdminTable
              label="Student progress"
              columns={[
                "Student",
                "Companies",
                "Completed runs",
                "Best year",
                "Peak value",
                "Last active",
                "Company details",
              ]}
              numericColumns={[
                "Companies",
                "Completed runs",
                "Best year",
                "Peak value",
              ]}
            >
              {students.map((s) => (
                <tr key={s.profile_id}>
                  <AdminCell label="Student" primary>
                    <strong>{s.name}</strong>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {s.email}
                    </p>
                  </AdminCell>
                  <AdminCell label="Companies" numeric>
                    {s.companies}
                  </AdminCell>
                  <AdminCell label="Completed runs" numeric>
                    {s.runs_completed}
                  </AdminCell>
                  <AdminCell label="Best year" numeric>
                    {s.best_year}
                  </AdminCell>
                  <AdminCell label="Peak value" numeric>
                    {fmtMoney(s.peak_valuation)}
                  </AdminCell>
                  <AdminCell label="Last active">
                    {s.last_active
                      ? new Date(s.last_active).toLocaleString()
                      : "Not active yet"}
                  </AdminCell>
                  <AdminCell label="Company details">
                    <details>
                      <summary className="cursor-pointer font-bold">
                        View companies
                      </summary>
                      <ul className="min-w-48 space-y-4 py-3">
                        {s.companiesDetail.map((c, i) => (
                          <li key={i}>
                            <strong>{c.name}</strong>
                            <p>
                              {c.industry} · Year {c.year}, month {c.month} ·{" "}
                              {c.alive ? "Active" : "Ended"}
                            </p>
                            <p>
                              Value {fmtMoney(c.valuation)} · Peak{" "}
                              {fmtMoney(c.peakValuation)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </AdminCell>
                </tr>
              ))}
            </AdminTable>
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              className={button}
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              Previous
            </button>
            <span className="text-sm">
              {total
                ? `${offset + 1}–${Math.min(total, offset + 50)} of ${total}`
                : "0 students"}
            </span>
            <button
              className={button}
              disabled={offset + 50 >= total || loading}
              onClick={() => setOffset(offset + 50)}
            >
              Next
            </button>
          </div>
        </section>
      )}
      {tab === "Competitions" && (
        <CompetitionManager chapterId={chapterId} active={active} />
      )}
      {tab === "Administrators" && (
        <section className="py-6">
          <h2 className="text-xl font-extrabold">Enterprise administrators</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Administrators can manage students and competitions. They do not use
            student seats. The owner controls administrator access and billing.
          </p>
          <ul className="mt-5 divide-y divide-[var(--hairline)]">
            {admins.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 break-words text-sm">
                  <strong>{a.email}</strong>
                  <p>
                    {a.accepted_at ? "Administrator" : "Invitation pending"}
                  </p>
                </div>
                {role === "owner" && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void remove(a.id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          {role === "owner" && (
            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault();
                void invite();
              }}
            >
              <label className="block text-sm font-bold">
                Invite an administrator
                <input
                  type="email"
                  required
                  className={field + " mt-2"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teacher@school.edu"
                />
              </label>
              <button className={primary + " mt-3"} disabled={busy || !active}>
                Create invitation
              </button>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                Share the invitation link. The recipient must sign in with this
                verified email address to accept.
              </p>
            </form>
          )}
          {inviteLink && (
            <div role="status" className="mt-4">
              <label className="block text-sm font-bold">
                Invitation link
                <input
                  className={field + " mt-2"}
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <button
                className={button + " mt-2"}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inviteLink)
                    .catch(() =>
                      setError("Select the invitation link and copy it."),
                    )
                }
              >
                Copy link
              </button>
            </div>
          )}
        </section>
      )}
      {tab === "Members" && children}
    </div>
  );
}
function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function CompetitionManager({
  chapterId,
  active,
}: {
  chapterId: string;
  active: boolean;
}) {
  const [show, setShow] = useState(false);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(() =>
    localInput(new Date(Date.now() + 3600000)),
  );
  const [end, setEnd] = useState(() =>
    localInput(new Date(Date.now() + 49 * 3600000)),
  );
  const [enrollment, setEnrollment] = useState("automatic");
  const [audience, setAudience] = useState("all");
  const [chosen, setChosen] = useState<Map<string, Student>>(new Map());
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Student[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([
    { place: 1, kind: "chest", quantity: 1, tier: 3 },
  ]);
  useEffect(() => {
    if (audience !== "selected") return;
    let alive = true;
    const timer = setTimeout(
      () =>
        void competitionRequest(
          `/api/chapter/progress?chapterId=${chapterId}&q=${encodeURIComponent(search)}`,
        )
          .then((d) => {
            if (alive) setMatches(d.students);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [audience, search, chapterId]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await competitionRequest(`/api/competitions?chapterId=${chapterId}`, {
        title,
        description,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        enrollment,
        audience,
        students: [...chosen.keys()],
        prizes,
      });
      setShow(false);
      setTitle("");
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changePrize = (i: number, patch: Partial<Prize>) =>
    setPrizes((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <section className="pt-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-extrabold">Competitions</h2>
        <button
          className={primary}
          disabled={!active}
          onClick={() => setShow(!show)}
        >
          {show ? "Close form" : "Create competition"}
        </button>
      </div>
      {error && (
        <p role="alert" className="my-3 text-sm text-[var(--alert)]">
          {error}
        </p>
      )}
      {show && (
        <form
          className="my-5 space-y-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--n-2)] p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm font-bold">
            Title
            <input
              required
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={field + " mt-2"}
              placeholder="Two-day company challenge"
            />
          </label>
          <label className="block text-sm font-bold">
            Description
            <textarea
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field + " mt-2"}
              rows={3}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">
              Starts at
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={field + " mt-2"}
              />
            </label>
            <label className="text-sm font-bold">
              Ends at
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={field + " mt-2"}
              />
            </label>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Times use your current timezone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. Rules and
            rewards are fixed when published.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">
              Enrollment
              <select
                className={field + " mt-2"}
                value={enrollment}
                onChange={(e) => setEnrollment(e.target.value)}
              >
                <option value="automatic">Automatic entry</option>
                <option value="opt_in">Students choose to join</option>
              </select>
            </label>
            <label className="text-sm font-bold">
              Who can enter
              <select
                className={field + " mt-2"}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                <option value="all">All enterprise students</option>
                <option value="selected">Selected students</option>
              </select>
            </label>
          </div>
          {audience === "selected" && (
            <fieldset>
              <legend className="text-sm font-bold">
                Eligible students · {chosen.size} selected
              </legend>
              <input
                aria-label="Search eligible students"
                className={field + " mt-2"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email"
              />
              <div className="mt-2 max-h-56 overflow-y-auto">
                {matches.map((s) => (
                  <label
                    key={s.profile_id}
                    className="flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(s.profile_id)}
                      onChange={(e) =>
                        setChosen((prev) => {
                          const next = new Map(prev);
                          if (e.target.checked) next.set(s.profile_id, s);
                          else next.delete(s.profile_id);
                          return next;
                        })
                      }
                    />
                    <span>
                      {s.name} · {s.email}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 break-words text-xs">
                Selected:{" "}
                {[...chosen.values()].map((s) => s.name).join(", ") || "None"}
              </p>
            </fieldset>
          )}
          <fieldset>
            <legend className="text-sm font-bold">
              Prizes by finishing place
            </legend>
            <div className="mt-3 space-y-4">
              {prizes.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <label className="text-xs">
                    Place
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      value={p.place}
                      onChange={(e) =>
                        changePrize(i, { place: Number(e.target.value) })
                      }
                      className={field}
                    />
                  </label>
                  <label className="text-xs">
                    Reward
                    <select
                      className={field}
                      value={p.kind}
                      onChange={(e) =>
                        changePrize(i, {
                          kind: e.target.value as Prize["kind"],
                          tier: e.target.value === "chest" ? 3 : null,
                        })
                      }
                    >
                      <option value="chest">Chest</option>
                      <option value="runs">Run tickets</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    Quantity
                    <input
                      type="number"
                      required
                      min={1}
                      max={100}
                      value={p.quantity}
                      onChange={(e) =>
                        changePrize(i, { quantity: Number(e.target.value) })
                      }
                      className={field}
                    />
                  </label>
                  {p.kind === "chest" ? (
                    <label className="text-xs">
                      Chest tier
                      <select
                        value={p.tier ?? 3}
                        onChange={(e) =>
                          changePrize(i, { tier: Number(e.target.value) })
                        }
                        className={field}
                      >
                        {[1, 2, 3, 4, 5].map((t) => (
                          <option key={t} value={t}>
                            Tier {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="self-center text-xs">Never expire</p>
                  )}
                  <button
                    type="button"
                    className={button + " self-end"}
                    disabled={prizes.length === 1}
                    onClick={() =>
                      setPrizes((ps) => ps.filter((_, j) => i !== j))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={button + " mt-3"}
              disabled={prizes.length >= 100}
              onClick={() =>
                setPrizes((ps) => [
                  ...ps,
                  {
                    place: Math.max(...ps.map((p) => p.place)) + 1,
                    kind: "runs",
                    quantity: 1,
                    tier: null,
                  },
                ])
              }
            >
              Add prize place
            </button>
          </fieldset>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Only companies created online during the competition qualify. For
            sign-up competitions, students must join before creating their
            company. Each student’s highest verified valuation counts; the first
            received wins ties. Prizes are awarded automatically.
          </p>
          <button className={primary} disabled={busy}>
            {busy ? "Publishing…" : "Publish competition"}
          </button>
        </form>
      )}
      <CompetitionList chapterId={chapterId} refreshKey={version} />
    </section>
  );
}
export function AdministratorInvitations() {
  const [items, setItems] = useState<
    Array<{ id: string; email: string; chapters: { name: string } }>
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void competitionRequest("/api/chapter/admins")
      .then((d) => setItems(d.invitations))
      .catch(() => {});
  }, []);
  const accept = async (id: string) => {
    setBusy(true);
    try {
      const d = await competitionRequest("/api/chapter/admins", {
        action: "accept",
        invitationId: id,
      });
      window.location.assign(appPath("/chapter") + `?chapterId=${d.chapterId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="my-3 text-sm text-[var(--alert)]">
          {error}
        </p>
      )}
      {items.map((i) => (
        <section
          key={i.id}
          className="my-5 rounded-[var(--radius-card)] border border-[var(--color-prestige)] p-4"
        >
          <p className="text-sm">
            You’re invited to administer{" "}
            <strong>{i.chapters.name || "an enterprise"}</strong>.
          </p>
          <button
            className={primary + " mt-3"}
            disabled={busy}
            onClick={() => void accept(i.id)}
          >
            Accept administrator invitation
          </button>
        </section>
      ))}
    </>
  );
}
