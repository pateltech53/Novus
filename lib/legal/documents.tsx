import { SUPPORT_EMAIL } from "@/lib/app-info";

/**
 * The legal documents, as content rather than as pages.
 *
 * ── Why they are not just routes ────────────────────────────────────────────
 *
 * App Review expects a functional link to the privacy policy and to the terms
 * from inside the app (Guideline 5.1.1 and, for anything with a subscription,
 * 3.1.2). The obvious implementation — link to /privacy — is wrong in the
 * shipped app for a specific reason: on iOS the tab bar and the advance button
 * are UIKit views composited ABOVE the webview (see components/native/
 * usePlayChrome.ts), so navigating the webview to a document leaves the game's
 * chrome sitting on top of a privacy policy. Rendering the same text in a
 * sheet keeps one screen, one back gesture, and no chrome to withdraw.
 *
 * So the text lives here and is rendered twice: by app/privacy and app/terms
 * for the public web and for the two URLs App Store Connect asks for, and by
 * components/LegalSheet inside the app. One source, so the version a reviewer
 * reads on the listing is the version the app shows.
 *
 * One consequence, and it is the reason the cross-references below are written
 * out rather than linked: an `<a href>` in this text navigates the WEBVIEW when
 * the sheet is the thing rendering it. From /privacy the reader is one "‹
 * NOVUS" away from the marketing landing — prices, plan buttons and all — which
 * is precisely the surface a store build must never show (Guideline 3.1.1).
 * Naming a URL in prose leads nobody anywhere by accident; linking one does.
 *
 * Everything asserted below has an implementation behind it. When the
 * behaviour changes, this file changes in the same release and `lastUpdated`
 * moves with it.
 */

export interface LegalSection {
  heading: string;
  body: React.ReactNode;
}

export interface LegalDocument {
  id: "privacy" | "terms";
  /** The <h1>, and the sheet's title. */
  title: string;
  /** The route on the marketing site. Given to App Store Connect verbatim. */
  path: string;
  lastUpdated: string;
  sections: readonly LegalSection[];
}

const Mail = ({ bold }: { bold?: boolean }) => (
  <a
    className={`underline underline-offset-4${bold ? " font-bold" : ""}`}
    href={`mailto:${SUPPORT_EMAIL}`}
  >
    {SUPPORT_EMAIL}
  </a>
);

// ── Privacy ──────────────────────────────────────────────────────────────────

/**
 * Written to describe what the code ACTUALLY does, checked against the
 * implementation it describes — the camera pipeline (lib/ai/delivery-coach.ts),
 * the transcription paths (lib/ai/transcribe.ts), the storage layer
 * (localStorage, plus Supabase once signed in — lib/cloud/sync.ts), accounts
 * (app/api/auth/*) and payments (lib/stripe/*). Every claim here has a file
 * behind it.
 *
 * Voice: plain sentences a fourteen-year-old and their parent can both read.
 * No "we value your privacy" throat-clearing. Facts, in order of what people
 * actually worry about: the camera, the mic, what leaves the device, minors.
 */
export const PRIVACY: LegalDocument = {
  id: "privacy",
  title: "Privacy",
  path: "/privacy",
  lastUpdated: "August 1, 2026",
  sections: [
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
          progress, all of it — and the deletion is real, not a flag. You do not
          have to ask: <strong>Settings › Account › Delete account</strong> does
          it from inside the app, immediately, with one confirmation.
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
          </strong>{" "}
          Say no to the camera and the game still works: you can pitch on
          microphone alone, or type.
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
          advertising SDKs and no social pixels anywhere in it, and nothing in
          Novus tracks you across other companies&rsquo; apps or websites.
        </>
      ),
    },
    {
      heading: "Payments",
      body: (
        <>
          Nothing is sold inside the iPhone or Android app. Pro is bought on the
          web, and payments run through <strong>Stripe</strong>: you are taken to
          a page hosted by Stripe, you enter your card there, and you come back.{" "}
          <strong>We never see or store your card number</strong> — no part of it
          ever reaches Novus, and Stripe loads no code onto our pages.
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
          manages, write to <Mail bold /> and a human on the team will answer.
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
  ],
};

// ── Terms ────────────────────────────────────────────────────────────────────

/**
 * The terms of use, which double as the end-user licence agreement.
 *
 * An app with a subscription needs a functional link to one from the listing
 * and from inside the app (Guideline 3.1.2). Apple's own standard EULA would
 * have done, except that it describes a product sold through the App Store and
 * Novus Pro is not: it is bought on the web and attaches to an account. So this
 * is a custom EULA, and a custom EULA has to contain Apple's minimum terms —
 * the last section is those, in the order Schedule 1 asks for them.
 *
 * Same voice as the privacy policy. A teenager and a school's business manager
 * both have to be able to read it.
 */
export const TERMS: LegalDocument = {
  id: "terms",
  title: "Terms of Use",
  path: "/terms",
  lastUpdated: "August 1, 2026",
  sections: [
    {
      heading: "The short version",
      body: (
        <>
          Novus is a game about running a company. Play it, and these terms are
          the deal: we license it to you, you do not resell or break it, the free
          game is free forever, Pro adds content and never an advantage, and
          either of us can end the arrangement at any time. Nothing here takes
          away a right your country gives you as a consumer.
        </>
      ),
    },
    {
      heading: "Who this is between",
      body: (
        <>
          These terms are an agreement between you and Novus (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;), the makers of the Novus app and of novuspitch.com.
          They apply whether you play in a browser or in the iPhone or Android
          app. Using Novus means you accept them; if you do not, the answer is
          simply not to use it.
        </>
      ),
    },
    {
      heading: "Your licence",
      body: (
        <>
          We give you a personal, non-exclusive, non-transferable licence to use
          Novus on any device you own or control, for as long as these terms
          hold. That is a licence, not a sale: the game, its writing, its art,
          its 3D models, its sound and its code stay ours.
          <br />
          <br />
          You may not sell, rent, sublicense or redistribute the app; copy its
          content into another product; reverse-engineer it except where the law
          says you may; or attack, overload or probe the servers behind it. Your
          companies, your names for them and the choices you make are yours.
        </>
      ),
    },
    {
      heading: "Accounts and age",
      body: (
        <>
          The free game needs no account. Making one requires an email address
          and a password you keep to yourself — you are responsible for what
          happens under your account, so pick a password you do not use anywhere
          else.
          <br />
          <br />
          <strong>Novus is for players aged 13 and over.</strong> If you are
          under 13, a parent or guardian should make the account, using their own
          email address, and supervise it. A school or club that buys a chapter
          licence is responsible for the seats it hands out. We may close an
          account we believe belongs to a child under 13 that no adult stands
          behind, and we will delete its data when we do.
        </>
      ),
    },
    {
      heading: "The camera, the microphone, and what you say",
      body: (
        <>
          A fiscal year in Novus does not close until you have pitched out loud.
          The camera and microphone are used for that, only while a pitch is on
          screen, and only after your device has asked you. Video frames are
          analysed on your device and discarded; nothing is recorded to disk or
          uploaded. The full detail is in the privacy policy — at
          novuspitch.com/privacy, or Settings &rsaquo; About Novus in the app —
          which is part of this agreement.
          <br />
          <br />
          You keep whatever you say and type. Do not use Novus to record anyone
          who has not agreed to be recorded, and do not type things into it —
          company names, pitches, messages — that are unlawful, hateful or
          somebody else&rsquo;s to publish. We can remove content and close
          accounts that break that.
        </>
      ),
    },
    {
      heading: "Novus Pro, and what it costs",
      body: (
        <>
          <strong>The free game is the whole game.</strong> Twelve months a year,
          the same year-end pitch, the same panel, the same scoring, the same
          board. Pro is an optional subscription that adds content — more
          industries, more rooms, more wardrobe, more concurrent companies.
          <br />
          <br />
          <strong>
            Nothing purchasable in Novus changes a score, saves a company, buys a
            revive, or moves you up the leaderboard.
          </strong>{" "}
          That is a rule about what we are allowed to build, not a marketing
          line.
          <br />
          <br />
          Pro is sold on the web at novuspitch.com and is billed by Stripe. It is
          a subscription: <strong>$6.99 per month or $39.99 per year</strong>, it
          renews automatically at the end of each period at the same price, and
          it keeps renewing until you cancel. Cancel at any time from your
          account, or by writing to us — you keep Pro until the end of the period
          you have already paid for, and nothing is taken after that. Chapter
          licences for classrooms and clubs are annual subscriptions billed the
          same way &mdash; they renew automatically each year at the same price
          until cancelled, and you can cancel at any time from your account or by
          writing to us.
          <br />
          <br />
          <strong>Nothing is sold inside the iPhone or Android app.</strong> Pro
          attaches to your Novus account rather than to a device, so it appears
          in the app when that account signs in, on every device you use.
        </>
      ),
    },
    {
      heading: "Refunds",
      body: (
        <>
          If you paid us and Novus did not do what this page says it does, write
          to <Mail /> and we will refund you. Where the law gives you a
          cancellation right — a fourteen-day right of withdrawal in the UK and
          EU, for example — you have it, and asking is enough. Anything bought
          through a store is refunded by that store under its own policy.
        </>
      ),
    },
    {
      heading: "The game, and what we do not promise",
      body: (
        <>
          Novus is a simulation and a piece of entertainment.{" "}
          <strong>
            Nothing in it is financial, investment, legal or business advice
          </strong>{" "}
          — the investors are fictional, the market is invented, and a valuation
          in Novus means nothing outside it. The coaching is a game mechanic, not
          a professional assessment of you.
          <br />
          <br />
          We work hard to keep Novus running and correct, but we provide it
          &ldquo;as is&rdquo;: we cannot promise it will never go down, never
          lose a saved company, or run on every device ever made. To the extent
          the law allows, we are not liable for indirect or consequential loss,
          and our total liability is limited to what you actually paid us in the
          twelve months before the problem. Nothing here limits liability for
          death, personal injury or fraud, or affects the statutory rights of a
          consumer.
        </>
      ),
    },
    {
      heading: "Ending it",
      body: (
        <>
          You can stop at any time. Deleting your account —{" "}
          <strong>Settings › Account › Delete account</strong> in the app, or the
          same control on the web — ends this agreement and erases what we hold,
          for real and immediately. We can suspend or close an account that
          breaks these terms, and we will say why when we do. If we ever
          discontinue Novus, we will give notice and refund the unused part of
          any subscription.
        </>
      ),
    },
    {
      heading: "Changes to these terms",
      body: (
        <>
          If these terms change, the date at the top of this page moves and the
          app shows the new version at the same time. A change that materially
          reduces what you get will not apply to a subscription period you have
          already paid for.
        </>
      ),
    },
    {
      heading: "Law, and how to reach us",
      body: (
        <>
          These terms are governed by the law of the State of California, and by
          any consumer-protection law of the country you live in that you cannot
          be asked to give up. Questions, complaints, refund requests and
          deletion requests all go to the same place: <Mail bold />, answered by
          a person.
        </>
      ),
    },
    {
      heading: "For apps downloaded from the App Store",
      body: (
        <>
          Where you got Novus from Apple&rsquo;s App Store, the following also
          applies, and Apple requires that it be said plainly:
          <br />
          <br />
          This agreement is between you and Novus only, <strong>not with
          Apple</strong>, and Novus alone is responsible for the app and its
          content. Your licence to use the app is a non-transferable licence to
          use it on any Apple-branded device you own or control, as permitted by
          the App Store Terms of Service. Apple has no obligation to provide
          maintenance or support for the app. If the app fails to conform to any
          applicable warranty, you may notify Apple and Apple will refund the
          purchase price of the app (which for Novus is nothing, as the app is
          free); to the maximum extent permitted by law, Apple has no other
          warranty obligation with respect to it. Novus, not Apple, is
          responsible for any claim that the app or your use of it infringes
          intellectual property, fails to conform to legal requirements, or
          gives rise to product-liability or consumer-protection claims. You
          confirm you are not in a country subject to a U.S. Government embargo
          or designated as terrorist-supporting, and are not on any U.S.
          Government restricted-parties list. <strong>Apple and its
          subsidiaries are third-party beneficiaries of this agreement</strong>{" "}
          and may enforce it against you.
        </>
      ),
    },
  ],
};

export const LEGAL_DOCUMENTS = [PRIVACY, TERMS] as const;
