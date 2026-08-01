import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { PRIVACY } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Privacy — Novus",
  description:
    "How Novus handles your camera, microphone, account and payment data. Short version: your video never leaves your device, an account stores only your email and progress, we never see your card, and we don't sell anything about you.",
  alternates: { canonical: "https://novuspitch.com/privacy" },
};

/**
 * The privacy policy.
 *
 * The text moved to lib/legal/documents.tsx when the app grew an in-app reader
 * for it: App Review wants a link to this policy from inside the app, and the
 * shipped app cannot navigate the webview to a route without leaving its
 * native chrome on top of the result. Two renderers, one source — see that
 * file's header for the whole argument.
 */
export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} />;
}
