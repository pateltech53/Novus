import "server-only";

/**
 * The two emails a chapter sends, written here so the copy exists exactly
 * once. Both are self-contained HTML: no images, no external CSS, no web
 * font, no tracking pixel — an email to a student may carry nothing that
 * phones home, for the same §9.6 reasons the board screen may not.
 *
 * The voice is the product's: states facts, asks nothing twice, no urgency
 * theatrics. An invite is "a seat exists and this link claims it", not
 * "you've been specially selected".
 *
 * ── Why this is built the way it is ────────────────────────────────────────
 *
 * An email is not a web page. There is no cascade worth trusting, no layout
 * engine in common, and one of the clients is Word. So the design is carried
 * three ways, in descending order of how much the client can be trusted:
 *
 *   1. **Inline styles on tables.** This is the whole design, and it is the
 *      only layer Gmail is guaranteed to keep — it strips <style> in a
 *      forwarded or clipped message. Everything below is addition, never
 *      foundation.
 *   2. **A <style> block** for the two things inline cannot express: the dark
 *      scheme, and the phone breakpoint. It needs !important, because an
 *      inline style outranks a stylesheet.
 *   3. **MSO conditionals.** Word ignores max-width on anything that is not a
 *      table and has never drawn a rounded corner, so Outlook gets a fixed
 *      table width and a VML pill. It is the floor, not the target: the
 *      design is tuned for the clients that can actually render it, and
 *      degrades to square corners and a flat button rather than being held
 *      down to what Word can do.
 *
 * Colours are the app's own tokens (app/globals.css) converted out of oklch,
 * which no mail client understands. The button is `--action` at its light-
 * theme value (#E35F00) rather than brand #FF6B00 for the same reason the app
 * makes that swap: white on brand orange is 2.9:1, and this sits on white.
 */

// ── The palette, light and dark ─────────────────────────────────────────────

const LIGHT = {
  ground: "#EDEBE6", // --n-1, the tint around the card
  card: "#FFFFFF", // --n-3
  sunk: "#F5F3F0", // --n-2, the paste-this-link well
  line: "#DAD9D5", // --n-5
  heading: "#100D07", // --n-11
  body: "#5F5C56", // --n-8
  // --n-7 is the app's tertiary, but the app sets it on white and never below
  // 11px. The footnote here is 11.5px on the tinted ground, where n-7 falls to
  // about 3:1 — so this is n-7 pulled halfway to n-8 and it clears 4.5:1.
  muted: "#6E6B65",
  gold: "#8A6D3B", // prestige, darkened to hold AA on white
  action: "#E35F00", // --action, light theme
} as const;

const DARK = {
  ground: "#101214",
  card: "#191B1E",
  sunk: "#131518",
  line: "#3C3D40",
  heading: "#F8F8F9",
  body: "#A9AAAE",
  muted: "#8B8C90",
  gold: "#FFC24B", // the real prestige gold — it only works on a dark ground
  action: "#FF6B00", // brand orange, which needs a dark ground to be legible
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** `&` inside an href is an entity opener to an HTML parser. Supabase's
 *  action links are full of them. */
const attr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The head stylesheet: dark scheme and the phone breakpoint, and nothing that
 * the message cannot survive without. Every rule needs !important — it is
 * overriding an inline style by design.
 */
const STYLE = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media only screen and (max-width: 600px) {
    .nv-pad   { padding: 28px 22px !important; }
    .nv-h1    { font-size: 27px !important; }
    .nv-btn a { display: block !important; }
  }
  @media (prefers-color-scheme: dark) {
    .nv-ground { background: ${DARK.ground} !important; }
    .nv-card   { background: ${DARK.card} !important; border-color: ${DARK.line} !important; }
    .nv-sunk   { background: ${DARK.sunk} !important; border-color: ${DARK.line} !important; }
    .nv-rule   { background: ${DARK.line} !important; }
    .nv-h1, .nv-strong { color: ${DARK.heading} !important; }
    .nv-body   { color: ${DARK.body} !important; }
    .nv-muted  { color: ${DARK.muted} !important; }
    .nv-gold   { color: ${DARK.gold} !important; }
    .nv-num    { background: ${DARK.sunk} !important; border-color: ${DARK.line} !important; color: ${DARK.gold} !important; }
    .nv-btn a  { background: ${DARK.action} !important; }
  }`;

/**
 * The frame every chapter email is poured into: a tinted ground, one card,
 * the wordmark, and the standing footnote about why this arrived.
 *
 * `preheader` is the line the inbox shows after the subject. Left to itself a
 * client scrapes the first text it finds, which here would be the word NOVUS
 * followed by the headline it is already showing — a wasted line in the one
 * place a student decides whether to open anything.
 */
const shell = (preheader: string, body: string): string => `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
    <style>${STYLE}</style>
  </head>
  <body class="nv-ground" style="margin:0;padding:0;width:100%;background:${LIGHT.ground};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:${LIGHT.ground};">
      ${preheader}&#8203;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="nv-ground" style="background:${LIGHT.ground};">
      <tr>
        <td align="center" style="padding:32px 16px 40px;">
          <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" align="center"><tr><td><![endif]-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;">
            <tr>
              <td class="nv-card" style="background:${LIGHT.card};border:1px solid ${LIGHT.line};border-radius:20px;box-shadow:0 3px 6px rgba(35,32,25,0.05),0 10px 24px rgba(35,32,25,0.06);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td class="nv-pad" style="padding:36px 40px 38px;font-family:${FONT};">
                      <!-- The wordmark sits inside the card, directly above the
                           headline, because that is the lockup every screen in
                           the app opens with (/join, /reset, /join/setup). -->
                      <p class="nv-gold" style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.2em;color:${LIGHT.gold};">NOVUS</p>
${body}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="nv-muted" style="padding:22px 10px 0;font-family:${FONT};font-size:11.5px;line-height:1.7;color:${LIGHT.muted};">
                Novus is a business simulation for classrooms and clubs. If you
                were not expecting this email, you can ignore it — nothing
                happens without the link above.
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;

/**
 * The call to action. A pill everywhere that can draw one, and — through the
 * VML underneath — a real filled button in Outlook rather than the bare
 * orange text that a padded inline-block degrades to there.
 */
const button = (href: string, label: string): string => {
  const url = attr(href);
  return `
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="nv-btn" style="margin:26px 0 0;">
                        <tr>
                          <td align="center" bgcolor="${LIGHT.action}" style="border-radius:999px;">
                            <!--[if mso]>
                            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:50px;v-text-anchor:middle;width:248px;" arcsize="50%" stroke="f" fillcolor="${LIGHT.action}">
                              <w:anchorlock/>
                              <center style="color:#ffffff;font-family:${FONT};font-size:15px;font-weight:bold;letter-spacing:0.04em;">${label}</center>
                            </v:roundrect>
                            <![endif]-->
                            <!--[if !mso]><!-->
                            <a href="${url}" style="display:inline-block;padding:16px 34px;border-radius:999px;background:${LIGHT.action};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:0.04em;line-height:1;text-decoration:none;">${label}</a>
                            <!--<![endif]-->
                          </td>
                        </tr>
                      </table>`;
};

/** A hairline. A 1px table row, because a <hr> is styled differently by every
 *  client that has an opinion about it. */
const rule = (space: string): string => `
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:${space};">
                        <tr><td class="nv-rule" height="1" style="height:1px;line-height:1px;font-size:1px;background:${LIGHT.line};">&nbsp;</td></tr>
                      </table>`;

/** What happens after the button, numbered. Three short lines are the
 *  difference between a link and a plan. */
const steps = (items: readonly string[]): string => `
                      <p class="nv-gold" style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.18em;color:${LIGHT.gold};">WHAT HAPPENS NEXT</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
${items
  .map(
    (item, i) => `                        <tr>
                          <td width="26" valign="top" style="padding:0 12px ${i === items.length - 1 ? "0" : "10px"} 0;">
                            <div class="nv-num" style="width:24px;height:24px;line-height:24px;border-radius:12px;background:${LIGHT.sunk};border:1px solid ${LIGHT.line};color:${LIGHT.gold};font-family:${FONT};font-size:11px;font-weight:800;text-align:center;">${i + 1}</div>
                          </td>
                          <td class="nv-strong" valign="top" style="padding:2px 0 ${i === items.length - 1 ? "0" : "10px"};font-family:${FONT};font-size:14px;line-height:1.45;color:${LIGHT.heading};">${item}</td>
                        </tr>`,
  )
  .join("\n")}
                      </table>`;

/** The plain-URL escape hatch, in a well rather than loose on the page — a
 *  90-character Supabase link set as body copy is the ugliest thing an
 *  otherwise clean email can contain. */
const fallback = (url: string): string => `
                      <p class="nv-muted" style="margin:0 0 8px;font-size:11px;line-height:1.6;color:${LIGHT.muted};">
                        If the button does not work, paste this into your browser:
                      </p>
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="nv-sunk" style="background:${LIGHT.sunk};border:1px solid ${LIGHT.line};border-radius:10px;">
                        <tr>
                          <td style="padding:11px 13px;font-family:${FONT};font-size:11px;line-height:1.55;word-break:break-all;">
                            <a href="${attr(url)}" class="nv-body" style="color:${LIGHT.body};text-decoration:none;">${attr(url)}</a>
                          </td>
                        </tr>
                      </table>`;

const H1 = `class="nv-h1" style="margin:10px 0 0;font-size:30px;font-weight:800;letter-spacing:-0.025em;line-height:1.12;color:${LIGHT.heading};"`;
const P = `class="nv-body" style="margin:14px 0 0;font-size:15px;line-height:1.68;color:${LIGHT.body};"`;

// ── The two emails ──────────────────────────────────────────────────────────

/** The invite: a seat is waiting, the link claims it. */
export function inviteEmail(joinUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  return {
    subject: "You have a Novus seat — claim it",
    html: shell(
      "A seat on your class licence is set aside for this address. One link, two fields, and it is yours.",
      `                      <h1 ${H1}>
                        A seat is waiting<br>for you.
                      </h1>
                      <p ${P}>
                        Your classroom or club runs Novus — you found a company,
                        keep it alive, and defend it out loud once a year. A seat
                        has been set aside for this address.
                      </p>
${button(joinUrl, "CLAIM YOUR SEAT")}
${rule("30px 0")}
${steps([
  "Confirm your email and name",
  "Choose a password",
  "Found your company",
])}
${rule("30px 0 24px")}
${fallback(joinUrl)}`,
    ),
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
    html: shell(
      "A one-time link to set a new password on your Novus account.",
      `                      <h1 ${H1}>
                        Choose your<br>password.
                      </h1>
                      <p ${P}>
                        This link signs you in to your Novus account and lets you
                        set a new password. It works once, and nothing changes
                        until you use it.
                      </p>
${button(resetUrl, "CHOOSE A PASSWORD")}
${rule("30px 0 24px")}
${fallback(resetUrl)}`,
    ),
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
