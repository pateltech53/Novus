import type { Metadata } from "next";

import { LegalPage } from "@/components/LegalPage";
import { TERMS } from "@/lib/legal/documents";

export const metadata: Metadata = {
  title: "Terms of Use — Novus",
  description:
    "The agreement behind Novus: your licence to play, what Novus Pro costs and how it renews, what nothing purchasable can ever buy, and how to end it all in one tap.",
  alternates: { canonical: "https://novuspitch.com/terms" },
};

/**
 * The terms of use, and the app's EULA.
 *
 * This URL is what goes in App Store Connect's "Licence Agreement" field and
 * in the required link beside anything that sells a subscription (Guideline
 * 3.1.2). The text is in lib/legal/documents.tsx so this page and the sheet
 * inside the app cannot drift apart.
 */
export default function TermsPage() {
  return <LegalPage doc={TERMS} />;
}
