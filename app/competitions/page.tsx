"use client";
import { useMemo } from "react";
import { CompetitionList } from "@/components/competitions/CompetitionList";
import { appPath } from "@/lib/native/href";
import {
  useNativeOverlay,
  useNativeOverlayOwned,
} from "@/components/native/useNativeOverlay";
import { useResolvedTheme } from "@/lib/native/theme";
import "../admin/admin.css";
export default function CompetitionsPage() {
  const native = useNativeOverlayOwned();
  const theme = useResolvedTheme();
  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme,
        title: "Competitions",
        leading: [
          {
            id: "back",
            symbol: "chevron.backward",
            label: "Back to my company",
            style: "plain" as const,
          },
        ],
        trailing: [],
      }),
      [theme],
    ),
    {
      onAction: (id) => {
        if (id === "back") window.location.assign(appPath("/play"));
      },
    },
  );
  return (
    <main className="admin-console mx-auto max-w-4xl px-5 pb-[max(5rem,calc(var(--nv-overlay-bottom)+1rem))] pt-[max(2rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+1rem))]">
      {!native && (
        <a
          className="inline-flex min-h-11 items-center text-sm font-bold"
          href={appPath("/play")}
        >
          ← Back to my company
        </a>
      )}
      <h1 className="mt-4 text-3xl font-extrabold">Enterprise competitions</h1>
      <p className="mb-4 mt-3 text-sm text-[var(--text-secondary)]">
        Build a new company, grow its value, and win prizes with your
        classmates.
      </p>
      <CompetitionList />
    </main>
  );
}
