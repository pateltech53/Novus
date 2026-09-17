"use client";

import { useId } from "react";
import { ORGANIZATION_TYPES, type ChapterProfile } from "@/lib/chapter/profile";

/**
 * The same four fields describe an enterprise before checkout and in its
 * owner's console. Names can be shown to members; contact details stay in
 * the owner view. Native constraints are complemented by the shared server
 * validator, so a crafted checkout cannot bypass the registration step.
 */
export const EMPTY_CHAPTER_PROFILE: ChapterProfile = {
  name: "",
  organizationType: "school",
  contactName: "",
  contactEmail: "",
};

const TYPE_LABELS: Record<ChapterProfile["organizationType"], string> = {
  school: "School",
  university: "University",
  club: "Club or community",
  company: "Company",
  other: "Other organization",
};

const INPUT_CLASS = "mt-2 block min-h-12 w-full rounded-[var(--radius-row)] border border-[var(--hairline)] bg-[var(--n-2)] px-3 py-2.5 text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--n-11)] focus-visible:outline-none!";

export function ChapterProfileFields({ value, onChange, disabled = false }: {
  value: ChapterProfile;
  onChange: (profile: ChapterProfile) => void;
  disabled?: boolean;
}) {
  const uid = useId();
  const update = <K extends keyof ChapterProfile>(key: K, next: ChapterProfile[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 disabled:opacity-50">
      <legend className="sr-only">Enterprise basic information</legend>
      <div>
        <label htmlFor={`${uid}-name`} className="text-xs font-bold">Enterprise name</label>
        <input id={`${uid}-name`} name="organization" autoComplete="organization" required maxLength={100}
          value={value.name} onChange={(event) => update("name", event.target.value)}
          placeholder="Your school, club or company" className={INPUT_CLASS} aria-describedby={`${uid}-visibility`} />
        <p id={`${uid}-visibility`} className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          Members see this name in their enterprise leaderboard.
        </p>
      </div>
      <div>
        <label htmlFor={`${uid}-type`} className="text-xs font-bold">Organization type</label>
        <select id={`${uid}-type`} required value={value.organizationType}
          onChange={(event) => update("organizationType", event.target.value as ChapterProfile["organizationType"])}
          className={INPUT_CLASS}>
          {ORGANIZATION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${uid}-contact`} className="text-xs font-bold">Contact name</label>
        <input id={`${uid}-contact`} name="name" autoComplete="name" required maxLength={100}
          value={value.contactName} onChange={(event) => update("contactName", event.target.value)} className={INPUT_CLASS} />
      </div>
      <div>
        <label htmlFor={`${uid}-email`} className="text-xs font-bold">Contact email</label>
        <input id={`${uid}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" required maxLength={254}
          value={value.contactEmail} onChange={(event) => update("contactEmail", event.target.value)} className={INPUT_CLASS} />
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          Contact details are for managing your enterprise and are not shown to members.
        </p>
      </div>
    </fieldset>
  );
}
