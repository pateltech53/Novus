import "server-only";

/**
 * The two emails a chapter sends, written here so the copy exists exactly
 * once. Both are self-contained HTML: no images, no external CSS, no
 * tracking pixel — an email to a student may carry nothing that phones home,
 * for the same §9.6 reasons the board screen may not.
 *
 * The voice is the product's: states facts, asks nothing twice, no urgency
 * theatrics. An invite is "a seat exists and this link claims it", not
 * "you've been specially selected".
 */

const shell = (body: string): string => `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f2;">
    <div style="max-width:28rem;margin:0 auto;padding:40px 24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.18em;color:#8a6d3b;">NOVUS</p>
      ${body}
      <p style="margin:28px 0 0;font-size:11px;line-height:1.6;color:#8b8b86;">
        Novus is a business simulation for classrooms and clubs. If you were not
        expecting this email, you can ignore it — nothing happens without the
        link above.
      </p>
    </div>
  </body>
</html>`;

const button = (href: string, label: string): string =>
  `<a href="${href}" style="display:inline-block;margin:20px 0 0;padding:14px 28px;border-radius:999px;background:#ff6b00;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:0.04em;text-decoration:none;">${label}</a>`;

/** The invite: a seat is waiting, the link claims it. */
export function inviteEmail(joinUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  return {
    subject: "You have a Novus seat — claim it",
    html: shell(`
      <h1 style="margin:10px 0 0;font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.2;">
        A seat is waiting for you.
      </h1>
      <p style="margin:14px 0 0;font-size:14px;line-height:1.65;color:#4a4a46;">
        Your classroom or club runs Novus — you found a company, keep it alive,
        and defend it out loud once a year. A seat has been set aside for this
        address. Open the link, confirm your email and name, and choose your
        password.
      </p>
      ${button(joinUrl, "CLAIM YOUR SEAT")}
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6d6d68;">
        If the button does not work, paste this into your browser:<br>
        <span style="word-break:break-all;color:#4a4a46;">${joinUrl}</span>
      </p>`),
    text: [
      "A Novus seat is waiting for you.",
      "",
      "Your classroom or club runs Novus. A seat has been set aside for this",
      "address. Open the link, confirm your email and name, and choose your",
      "password:",
      "",
      joinUrl,
      "",
      "If you were not expecting this email, ignore it — nothing happens",
      "without the link.",
    ].join("\n"),
  };
}

/** The password link: sent on RESEND for seats that are past claiming. */
export function passwordEmail(resetUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  return {
    subject: "Choose your Novus password",
    html: shell(`
      <h1 style="margin:10px 0 0;font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.2;">
        Choose your password.
      </h1>
      <p style="margin:14px 0 0;font-size:14px;line-height:1.65;color:#4a4a46;">
        This link signs you in to your Novus account and lets you set a new
        password. It works once.
      </p>
      ${button(resetUrl, "CHOOSE A PASSWORD")}
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6d6d68;">
        If the button does not work, paste this into your browser:<br>
        <span style="word-break:break-all;color:#4a4a46;">${resetUrl}</span>
      </p>`),
    text: [
      "Choose your Novus password.",
      "",
      "This link signs you in to your Novus account and lets you set a new",
      "password. It works once:",
      "",
      resetUrl,
    ].join("\n"),
  };
}
