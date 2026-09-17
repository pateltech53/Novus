"use client";
import { Fragment, useEffect, useState } from "react";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { AdminCell, AdminTable } from "./table";

/** Enterprise and audit reads. Each request owns an abort
 * signal, so changing a filter cannot let an older response replace it. */
function useRows<T>(
  path: string,
  params: Record<string, string>,
  refreshKey: number,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams(params).toString();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(apiUrl(`${path}?${query}`), {
          credentials: API_CREDENTIALS,
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? "Could not load this workspace.");
        if (!controller.signal.aborted) {
          setRows(body.rows ?? []);
          setTotal(body.total ?? 0);
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [path, query, refreshKey, retry]);
  return { rows, total, loading, error, retry: () => setRetry((n) => n + 1) };
}
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : "—";
export const adminField =
  "min-w-0 w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-[var(--n-2)] px-3 py-2 text-sm";
export const adminButton =
  "nv-gc rounded-[var(--radius-row)] px-4 py-2 text-xs font-bold disabled:opacity-35";
export function PageControls({
  page,
  total,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="tnum text-xs text-[var(--text-secondary)]">
        {total === 0
          ? "0 results"
          : page * 50 >= total
            ? `No records on this page · ${total.toLocaleString()} total`
            : `${page * 50 + 1}–${Math.min((page + 1) * 50, total)} of ${total.toLocaleString()}`}
      </p>
      <div className="flex gap-2">
        <button
          className={adminButton}
          disabled={loading || page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          className={adminButton}
          disabled={loading || (page + 1) * 50 >= total}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  return loading ? (
    <p role="status" className="py-6 text-sm">
      Loading records…
    </p>
  ) : error ? (
    <div
      role="alert"
      className="my-4 rounded-[var(--radius-card)] border border-[var(--alert)] p-4"
    >
      <p>{error}</p>
      <button className={`${adminButton} mt-2`} onClick={retry}>
        Retry
      </button>
    </div>
  ) : null;
}
interface Enterprise {
  id: string;
  name: string | null;
  owner_profile_id: string;
  owner_email: string | null;
  organization_type: string | null;
  contact_name: string | null;
  contact_email: string | null;
  licence: string;
  status: string;
  source: string;
  seats: number;
  occupied: number;
  available: number;
  pending: number;
  current_period_end: string | null;
}
interface Seat {
  id: string;
  profile_id: string;
  email: string;
  seat_name: string | null;
  pending: boolean;
  invite_sent_at: string | null;
  origin: string;
}
function Roster({
  id,
  onAccount,
}: {
  id: string;
  onAccount: (id: string, email: string | null) => void;
}) {
  const [page, setPage] = useState(0);
  const result = useRows<Seat>(
    `/api/admin/chapters/${id}`,
    { offset: String(page * 50) },
    0,
  );
  return (
    <div>
      <h3 className="font-bold">Enterprise roster</h3>
      <LoadState {...result} />
      {!result.loading && !result.error && (
        <AdminTable
          label="Enterprise roster"
          columns={["Member", "Invitation", "Last sent", "Account"]}
        >
          {result.rows.map((s) => (
            <tr key={s.id}>
              <AdminCell label="Member" primary>
                <b>{s.email}</b>
                <p className="text-xs">{s.seat_name}</p>
              </AdminCell>
              <AdminCell label="Invitation">
                {s.pending ? "Setup pending" : "Ready"}
              </AdminCell>
              <AdminCell label="Last sent">{date(s.invite_sent_at)}</AdminCell>
              <AdminCell label="Account">
                <button
                  className={adminButton}
                  onClick={() => onAccount(s.profile_id, s.email)}
                >
                  Open member
                </button>
              </AdminCell>
            </tr>
          ))}
          {!result.rows.length && (
            <tr>
              <td colSpan={4}>No seats assigned.</td>
            </tr>
          )}
        </AdminTable>
      )}
      {!result.loading && !result.error && (
        <PageControls
          page={page}
          total={result.total}
          loading={result.loading}
          onPage={setPage}
        />
      )}
    </div>
  );
}
export function EnterpriseWorkspace({
  onAccount,
  onRevoke,
  busy,
  refreshKey,
}: {
  onAccount: (id: string, email: string | null) => void;
  onRevoke: (id: string) => void;
  busy: boolean;
  refreshKey: number;
}) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const result = useRows<Enterprise>(
    "/api/admin/chapters",
    { q: search, status, source, offset: String(page * 50) },
    refreshKey,
  );
  return (
    <>
      <h2 className="text-xl font-extrabold">Enterprises</h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Licence health, seat availability and invitation setup across every
        enterprise. Open an owner to manage grants.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setPage(0);
        }}
      >
        <label className="text-xs font-bold">
          Name or contact
          <input
            className={`${adminField} mt-1`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Enterprise, owner or contact email"
          />
        </label>
        <label className="text-xs font-bold">
          Status
          <select
            className={`${adminField} mt-1`}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="lapsed">Lapsed</option>
            <option value="expiring">Due within 30 days</option>
          </select>
        </label>
        <label className="text-xs font-bold">
          Licence
          <select
            className={`${adminField} mt-1`}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All sources</option>
            <option value="stripe">Paid</option>
            <option value="comp">Gifted</option>
          </select>
        </label>
        <button className={`${adminButton} self-end`}>Search</button>
      </form>
      <LoadState {...result} />
      {!result.loading && !result.error && (
        <>
          <AdminTable
            label="Enterprises"
            columns={[
              "Enterprise",
              "Licence",
              "Seats",
              "Invitations",
              "Period end",
              "Manage",
            ]}
          >
            {result.rows.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <AdminCell label="Enterprise" primary>
                    <b>{c.name ?? "Unnamed enterprise"}</b>
                    <p className="mt-1 text-xs">
                      {c.owner_email ?? "No owner email"}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {c.organization_type ?? "Type not set"}
                      {c.contact_name ? ` · ${c.contact_name}` : ""}
                    </p>
                  </AdminCell>
                  <AdminCell label="Licence">
                    <b>{c.status}</b>
                    <p className="text-xs">
                      {c.source === "comp" ? "Gifted" : "Paid"} ·{" "}
                      {c.licence.replace("chapter_", "")}
                    </p>
                  </AdminCell>
                  <AdminCell label="Seats">
                    <p className="tnum font-bold">
                      {c.occupied} / {c.seats}
                    </p>
                    <meter
                      aria-label={`${c.name ?? "Enterprise"} seats occupied`}
                      min={0}
                      max={c.seats}
                      value={c.occupied}
                      className="w-full"
                    />
                    <p className="text-xs">{c.available} available</p>
                  </AdminCell>
                  <AdminCell label="Invitations">
                    <b>{c.pending} pending</b>
                    <p className="text-xs">{c.occupied - c.pending} ready</p>
                  </AdminCell>
                  <AdminCell label="Period end">
                    {date(c.current_period_end)}
                    {c.status === "active" &&
                      c.current_period_end &&
                      Date.parse(c.current_period_end) <=
                        Date.now() + 30 * 86400000 && (
                        <p className="mt-1 text-xs font-bold text-[var(--alert)]">
                          {Date.parse(c.current_period_end) < Date.now()
                            ? "Past period end"
                            : c.source === "comp"
                              ? "Expires within 30 days"
                              : "Renewal due within 30 days"}
                        </p>
                      )}
                  </AdminCell>
                  <AdminCell label="Manage">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={adminButton}
                        aria-expanded={open === c.id}
                        onClick={() => setOpen(open === c.id ? null : c.id)}
                      >
                        Roster
                      </button>
                      <button
                        className={adminButton}
                        onClick={() =>
                          onAccount(c.owner_profile_id, c.owner_email)
                        }
                      >
                        Owner
                      </button>
                      {c.source === "comp" && c.status === "active" && (
                        <button
                          className={adminButton}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Revoke the gifted licence for ${c.name ?? c.owner_email}? The roster stays, but its Pro seats will lapse.`,
                              )
                            )
                              onRevoke(c.id);
                          }}
                        >
                          Revoke gift
                        </button>
                      )}
                    </div>
                  </AdminCell>
                </tr>
                {open === c.id && (
                  <tr className="admin-detail-row">
                    <td colSpan={6}>
                      <Roster id={c.id} onAccount={onAccount} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!result.rows.length && (
              <tr>
                <td colSpan={6}>No enterprises match these filters.</td>
              </tr>
            )}
          </AdminTable>
          <PageControls
            page={page}
            total={result.total}
            loading={result.loading}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}
interface Audit {
  id: string;
  action: string;
  actor_email: string | null;
  target_email: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}
export function AuditWorkspace({
  refreshKey,
  billingOnly = false,
}: {
  refreshKey: number;
  billingOnly?: boolean;
}) {
  const initial = {
    actor: "",
    target: "",
    action: billingOnly ? "billing_reconcile" : "",
    from: "",
    to: "",
  };
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(0);
  const result = useRows<Audit>(
    "/api/admin/audit",
    { ...filters, offset: String(page * 50) },
    refreshKey,
  );
  return (
    <>
      <h2 className="text-xl font-extrabold">
        {billingOnly ? "Reconciliation history" : "Audit log"}
      </h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Search recorded actions by operator, target and date. Date filters use
        UTC.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
          setPage(0);
        }}
      >
        {(
          [
            ["actor", "Administrator"],
            ["target", "Target account"],
            ["action", "Action"],
            ["from", "From (UTC)"],
            ["to", "Through (UTC)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-xs font-bold">
            {label}
            <input
              type={key === "from" || key === "to" ? "date" : "text"}
              className={`${adminField} mt-1`}
              value={draft[key]}
              disabled={billingOnly && key === "action"}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <button className={`${adminButton} self-end`}>Apply filters</button>
      </form>
      <LoadState {...result} />
      {!result.loading && !result.error && (
        <>
          <AdminTable
            label={billingOnly ? "Reconciliation history" : "Audit log"}
            columns={["Time", "Action", "Administrator", "Target", "Details"]}
          >
            {result.rows.map((a) => (
              <tr key={a.id}>
                <AdminCell label="Time" primary>
                  <time dateTime={a.created_at}>
                    {new Date(a.created_at).toLocaleString()}
                  </time>
                </AdminCell>
                <AdminCell label="Action">
                  <b>{a.action.replaceAll("_", " ")}</b>
                </AdminCell>
                <AdminCell label="Administrator">
                  {a.actor_email ?? "System / unknown"}
                </AdminCell>
                <AdminCell label="Target">{a.target_email ?? "—"}</AdminCell>
                <AdminCell label="Details">
                  <details>
                    <summary>View details</summary>
                    <pre className="max-w-sm whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(a.detail, null, 2)}
                    </pre>
                  </details>
                </AdminCell>
              </tr>
            ))}
            {!result.rows.length && (
              <tr>
                <td colSpan={5}>No actions match these filters.</td>
              </tr>
            )}
          </AdminTable>
          <PageControls
            page={page}
            total={result.total}
            loading={result.loading}
            onPage={setPage}
          />
        </>
      )}
    </>
  );
}
