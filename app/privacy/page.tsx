import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy — Novus",
  description:
    "How Novus handles your camera, microphone, account and payment data. Short version: your video never leaves your device, an account stores only your email and progress, we never see your card, and we don't sell anything about you.",
  alternates: { canonical: "https://novuspitch.com/privacy" },
};

/**
 * The privacy policy.
 *
 * Written to describe what the code ACTUALLY does, checked against the
 * implementation it describes — the camera pipeline (lib/ai/delivery-coach.ts),
 * the transcription paths (lib/ai/transcribe.ts), the storage layer
 * (localStorage, plus Supabase once signed in — lib/cloud/sync.ts), accounts
 * (app/api/auth/*) and payments (lib/stripe/*). Every claim here has a file
 * behind it. When the behaviour changes — a hosted STT, a second processor —
 * this page must change in the same release, and the "last updated" date with
 * it. Accounts and Stripe billing are the change this revision describes.
 *
 * Voice: plain sentences a fourteen-year-old and their parent can both read.
 * No "we value your privacy" throat-clearing. Facts, in order of what people
 * actually worry about: the camera, the mic, what leaves the device, minors.
 */

const LAST_UPDATED = "August 1, 2026";

const SECTIONS: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "The short version",
    body: (
      <>
        Your game plays on your device. Your camera footage never leaves it.
        Your microphone is used to understand your words, not your voice.
        Without an account, nothing about your game is sent to us at all. Make
        one and we store your email and a copy of your progress, so it survives
        a new phone — that is the whole of what we keep. We have no ads, no
        trackers, no data broker, and nothing about you for sale. Novus is
        played by minors, and we treat that as a design constraint, not a
        checkbox.
      </>
    ),
  },
  {
    heading: "Accounts, and the choice not to have one",
    body: (
      <>
        <strong>You can play the whole free game without an account, and if
        you do, nothing about your game is sent to us at all.</strong>{" "}
        No account is created for you in the background. Your companies live in
        your browser&rsquo;s local storage, on this device, and clearing your
        browser data deletes them — permanently, because there is no copy
        anywhere else.
        <br />
        <br />
        If you make an account, we ask for a display name you invent, an email
        address, and a password. The email is how you sign back in and how you
        reset a forgotten password; the password is stored only as a
        cryptographic hash by our authentication provider (Supabase), and nobody
        at Novus can read it. An account exists for two reasons: your progress
        follows you to another device, and a Pro subscription has something
        durable to attach to. We do not send marketing email, and there is no
        newsletter to be added to.
      </>
    ),
  },
  {
    heading: "What we store once you have an account",
    body: (
      <>
        Your email, your display name, your founder profile, your companies,
        your progress and your settings — held for us by Supabase, on servers we
        rent. That is the whole list. We do not store your age: the game asks it
        to adjust itself and that answer never leaves your device. We do not
        store your address, your school, your phone number, your real name (the
        display name is whatever you type), or a photo.
        <br />
        <br />
        Ask us to delete your account and we delete it — the email, the
        progress, all of it — and the deletion is real, not a flag.
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
    heading: "What leaves your device",
    body: (
      <>
        Without an account: nothing but the app&rsquo;s own files (images,
        sounds, the 3D models, the on-device coaching models), downloaded from
        wherever it is hosted, like any website. No game data, no identifier,
        nothing about you.
        <br />
        <br />
        With an account: your email, display name and game progress, to
        Supabase — and, if you buy Pro, the minimum needed to take a payment
        (below). That is the complete list. It sends no analytics, no
        telemetry, and nothing about you to anyone else. There are no
        advertising SDKs and no social pixels anywhere in it.
      </>
    ),
  },
  {
    heading: "Payments",
    body: (
      <>
        Payments run through <strong>Stripe</strong>. When you buy Pro you are
        taken to a page hosted by Stripe, you enter your card there, and you come
        back. <strong>We never see or store your card number</strong> — no part
        of it ever reaches Novus, and Stripe loads no code onto our pages.
        <br />
        <br />
        The only thing we tell Stripe about you is a random account identifier,
        so that when they confirm a payment we know which account to unlock.
        Stripe will ask you for an email for the receipt, and they hold that
        under their own privacy policy. We keep a record that your account has
        Pro, when the subscription renews, and Stripe&rsquo;s id for your
        customer record — never a card.
        <br />
        <br />
        Buying anything requires an account, because a purchase attached to a
        browser cookie would vanish the first time you cleared it.
      </>
    ),
  },
  {
    heading: "For parents and teachers",
    body: (
      <>
        Novus is built for students. An account asks for a display name the
        student invents, an email, and a password — and nothing else. No phone
        number, no real-name requirement, no photo, no address, no age stored on
        our side. The free game needs no account at all, and we would rather a
        younger student played that way.
        <br />
        <br />
        <strong>
          If your child is under 13, please make the account yourself and use
          your own email address.
        </strong>{" "}
        Buying Pro needs an account, and the card behind it should be a
        grown-up&rsquo;s decision either way. Nothing in the game can buy a
        score, a survival, or a leaderboard place, at any price — that is the
        one rule we will not sell an exception to. If you have questions, want
        an account deleted, or want anything explained better than this page
        manages, write to{" "}
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
