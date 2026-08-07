"use client";

/**
 * The three shapes every settings-style surface is built from.
 *
 * They lived at the bottom of SettingsScreen.tsx, which was fine while that
 * file was the only thing that used them. `AccountSection` moved out — the
 * welcome screen needs a sign-in door and must not pull the operator console,
 * the Pro card and the island list along with it — and these came with it,
 * because a shared helper that lives inside one of its two callers is a
 * circular import waiting to be written.
 *
 * Presentational only. Nothing here reads storage, and nothing here knows what
 * a company is.
 */

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        {label}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A 48px list row. The height is the tap target, not the text. */
const ROW =
  "nv-gc flex h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold text-[var(--text-primary)]";

export function RowLink({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a href={href} className={ROW}>
      {label}
      <span className="truncate text-2xs font-bold text-[var(--text-tertiary)]">
        {value}
      </span>
    </a>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  onCommit,
  type = "text",
  inputMode,
  autoComplete = "off",
  enterKeyHint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onCommit?: () => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
}) {
  // The name fields cap at 28 to keep a masthead one line; an email or a
  // password has no business being truncated.
  const capped = type === "text";
  return (
    // A field is a control, so it is made of the control material — the same
    // tint, crest and ring as the buttons under it, minus the press, which a
    // text field does not have.
    <label
      htmlFor={id}
      className="nv-ggroup block rounded-[var(--radius-row)] px-4 py-3"
    >
      <span className="block text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label.toUpperCase()}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(capped ? e.target.value.slice(0, 28) : e.target.value)}
        onBlur={onCommit}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        enterKeyHint={enterKeyHint}
        autoCapitalize={type === "email" ? "none" : undefined}
        autoCorrect={type === "email" ? "off" : undefined}
        spellCheck={type === "email" ? false : undefined}
        className="mt-1 w-full bg-transparent text-base font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />
    </label>
  );
}
