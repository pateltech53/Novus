import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — Novus",
  description:
    "How Novus handles your camera, microphone, and data. Short version: your game lives on your device, your video never leaves it, and we don't sell anything about you.",
  alternates: { canonical: "https://novuspitch.com/privacy" },
};

/**
 * The privacy policy.
 *
 * Written to describe what the code ACTUALLY does, checked against the
 * implementation it describes — the camera pipeline (lib/ai/delivery-coach.ts),
 * the transcription paths (lib/ai/transcribe.ts), and the storage layer
 * (localStorage throughout). Every claim here has a file behind it. When the
 * behaviour changes — real accounts, a billing provider, a hosted STT — this
 * page must change in the same release, and the "last updated" date with it.
 *
 * Voice: plain sentences a fourteen-year-old and their parent can both read.
 * No "we value your privacy" throat-clearing. Facts, in order of what people
 * actually worry about: the camera, the mic, what leaves the device, minors.
 */

const LAST_UPDATED = "July 31, 2026";

const SECTIONS: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "The short version",
    body: (
      <>
        Your game lives on your device. Your camera footage never leaves it.
        Your microphone is used to understand your words, not your voice. We
        have no ads, no trackers, no data broker, and nothing about you for
        sale. Novus is played by minors, and we treat that as a design
        constraint, not a checkbox.
      </>
    ),
  },
  {
    heading: "What we store, and where",
    body: (
      <>
        Your account (a display name you invent — we never ask for an email or
        a password), your founder profile, your companies, your progress and
        your settings are stored in your browser&rsquo;s local storage,{" "}
        <strong>on your device</strong>. There is no Novus server holding a copy.
        Clearing your browser data deletes it, and that deletion is real and
        permanent. When online accounts launch, anything that changes about
        this will be listed here first, and syncing will be something you turn
        on, not something that happens to you.
      </>
    ),
  },
  {
    heading: "The camera",
    body: (
      <>
        The camera turns on only when you start a pitch, and asks permission at
        that moment. The picture is shown to you (so you can see yourself
        pitching) and, if your device can run it, analysed <em>on the device</em>{" "}
        for delivery coaching — eye contact, gestures, posture. Each video frame
        is examined and immediately discarded; what survives is a handful of
        numbers (like &ldquo;eyes on the lens 74% of the take&rdquo;), which are
        shown to you and thrown away with the screen.{" "}
        <strong>
          No video frame is ever recorded to disk, stored, or sent anywhere, and
          delivery coaching never affects your score.
        </strong>
      </>
    ),
  },
  {
    heading: "The microphone",
    body: (
      <>
        The microphone turns on only while you pitch or take a call, with
        permission asked at that moment. Your speech is turned into text so the
        game can judge <em>what you said</em> — never your accent, never the
        pitch of your voice, never how you sound. Transcription runs in your
        browser where possible; your browser&rsquo;s own speech service may
        process audio to do that (that is between you and your browser vendor,
        and it is the same service its address bar uses). If we connect a
        dedicated transcription service in a future release, audio will be sent
        to it for transcription only, not stored, and this page will say so
        before it happens. You can always type instead of speaking — typing is
        never scored differently.
      </>
    ),
  },
  {
    heading: "What leaves your device today",
    body: (
      <>
        Almost nothing. The app downloads its own files (images, sounds, the 3D
        models, the on-device coaching models) from wherever it is hosted, like
        any website. It sends no analytics, no telemetry, and no personal data
        to us or to third parties. There are no advertising SDKs and no social
        pixels anywhere in it.
      </>
    ),
  },
  {
    heading: "Payments",
    body: (
      <>
        No card can be taken today. Choosing Pro switches it on for your device
        only. When real billing launches it will run through a payment
        processor; we will never see or store your card number, and this page
        will name the processor before the first charge happens.
      </>
    ),
  },
  {
    heading: "For parents and teachers",
    body: (
      <>
        Novus is built for students. That is why accounts are a display name and
        nothing else — no email, no password, no phone number, no real-name
        requirement, no photo. Nothing in the game can buy a score, a survival,
        or a leaderboard place, at any price. If you have questions, or want
        anything explained better than this page manages, write to{" "}
        <a className="font-bold underline underline-offset-4" href="mailto:team@novuspitch.com">
          team@novuspitch.com
        </a>{" "}
        and a human on the team will answer.
      </>
    ),
  },
  {
    heading: "Changes",
    body: (
      <>
        If any of the above changes — accounts, billing, transcription, hosting
        — this page changes in the same release, the date below moves, and
        anything that newly leaves your device will be opt-in where we can
        possibly make it so.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))]">
      <Link
        href="/"
        className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
      >
        ‹ NOVUS
      </Link>
      <h1 className="mt-3 text-[2rem] font-extrabold leading-tight tracking-[-0.02em]">
        Privacy
      </h1>
      <p className="tnum mt-1 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        LAST UPDATED {LAST_UPDATED.toUpperCase()}
      </p>

      {SECTIONS.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-base font-extrabold tracking-[-0.01em]">
            {s.heading}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            {s.body}
          </p>
        </section>
      ))}

      <p className="mt-10 border-t border-[var(--hairline)] pt-5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
        Novus · built at LaunchX Flagship, San Diego 2026 ·{" "}
        <a className="underline underline-offset-4" href="mailto:team@novuspitch.com">
          team@novuspitch.com
        </a>
      </p>
    </main>
  );
}
