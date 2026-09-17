import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { inviteEmail } from "@/lib/chapter/emails";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { SITE_URL } from "@/lib/stripe/config";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * A setup credential travels only to its account's mailbox, never back to a
 * caller holding an old chapter token. That boundary remains safe even if a
 * legacy claim overlaps password completion or a seat is removed mid-request.
 * New invites go directly to setup; legacy /join links request this email.
 */
export async function sendSetupEmail(db: SupabaseClient, email: string): Promise<string | null> {
  if (!SITE_URL) return "The site URL is not configured";
  if (resendConfigured()) {
    const { data, error } = await db.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo: `${SITE_URL}/join/setup` },
    });
    const link = data?.properties?.action_link;
    if (error || !link) return "Could not create the setup email. Try again.";
    return sendEmail({ to: email, ...inviteEmail(link) });
  }
  // Re-inviting a confirmed but unfinished account is refused by GoTrue.
  // Its recovery mail is a mailbox proof too, and must still land on setup.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/join/setup`,
  });
  return error ? "Could not send the setup email. Try again." : null;
}
