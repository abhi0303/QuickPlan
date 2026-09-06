/**
 * The branded shell every QuickPlan email is rendered into.
 *
 * Colours and radii are lifted straight from the frontend's own tokens
 * (`--primary`, `--bg`, `--r-lg` and friends) so an email looks like it came
 * from the same product as the app.
 *
 * Email is not the web. Everything here is a table with inline styles, because
 * Outlook still lays out with Word and Gmail strips most of what a stylesheet
 * would say. No external images either: Gmail blocks remote images until the
 * reader asks for them, so an icon that lives on a server is an icon nobody
 * sees. The badges are Unicode on a coloured circle instead.
 */

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const c = {
  bg: '#f4faf7',
  surface: '#ffffff',
  text: '#10241d',
  textSoft: '#3d5b52',
  muted: '#6e8a80',
  border: '#e2eee8',
  primary: '#0fb58a',
  primaryStrong: '#0a9a75',
  gradient: 'linear-gradient(135deg, #0fb58a 0%, #2ecfa1 45%, #6c7bff 130%)',
} as const;

const TONES = {
  primary: { wash: '#ddf5ed', ink: '#0a9a75' },
  periwinkle: { wash: '#e9ebff', ink: '#6c7bff' },
  tangerine: { wash: '#fff0df', ink: '#f2871f' },
  rose: { wash: '#ffe9ed', ink: '#e0526d' },
} as const;

export type Tone = keyof typeof TONES;

export interface EmailContent {
  /** The grey line Gmail shows after the subject in the inbox list. */
  preheader: string;
  badge: string;
  tone: Tone;
  heading: string;
  greeting: string;
  /** Body copy. Pre-escaped markup is expected; use esc() on anything typed by a person. */
  intro: string;
  action?: { label: string; url: string };
  /** Small print under the button, e.g. how long the link lives. */
  meta?: string;
  notice?: { tone: Tone; text: string };
  footer: string;
}

/** Names and addresses come from user input and must not become markup. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmail(content: EmailContent): string {
  const tone = TONES[content.tone];

  const button = content.action
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
                <tr>
                  <td align="center" bgcolor="${c.primary}" style="border-radius:14px;background-image:${c.gradient};">
                    <a href="${content.action.url}"
                       style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;">
                      ${esc(content.action.label)}
                    </a>
                  </td>
                </tr>
              </table>`
    : '';

  const meta = content.meta
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;">
                <tr>
                  <td bgcolor="${tone.wash}" style="border-radius:999px;padding:7px 16px;font-family:${FONT};font-size:13px;font-weight:600;color:${tone.ink};">
                    ${content.meta}
                  </td>
                </tr>
              </table>`
    : '';

  // Some clients mangle anchors, and a link you can neither click nor copy is
  // a dead end. The raw URL goes in as selectable text.
  const fallback = content.action
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
                <tr><td style="border-top:1px solid ${c.border};padding-top:20px;">
                  <p style="margin:0 0 8px;font-family:${FONT};font-size:13px;color:${c.muted};">
                    Button not working? Paste this into your browser:
                  </p>
                  <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;word-break:break-all;">
                    <a href="${content.action.url}" style="color:${c.primaryStrong};text-decoration:none;">${content.action.url}</a>
                  </p>
                </td></tr>
              </table>`
    : '';

  const notice = content.notice
    ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
                <tr>
                  <td bgcolor="${TONES[content.notice.tone].wash}" style="border-radius:16px;padding:16px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:${TONES[content.notice.tone].ink};font-weight:600;">
                    ${content.notice.text}
                  </td>
                </tr>
              </table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${c.bg};">
  <div style="display:none;font-size:1px;color:${c.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${esc(content.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

          <tr>
            <td align="center" bgcolor="${c.primary}" style="background-image:${c.gradient};border-radius:22px 22px 0 0;padding:30px 32px;">
              <span style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">QuickPlan</span>
            </td>
          </tr>

          <tr>
            <td bgcolor="${c.surface}" style="border-radius:0 0 22px 22px;padding:36px 32px 32px;border:1px solid ${c.border};border-top:none;">

              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" width="52" height="52" bgcolor="${tone.wash}" style="border-radius:999px;font-size:24px;line-height:52px;">
                    ${content.badge}
                  </td>
                </tr>
              </table>

              <h1 style="margin:22px 0 0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${c.text};">
                ${esc(content.heading)}
              </h1>

              <p style="margin:18px 0 0;font-family:${FONT};font-size:16px;line-height:1.6;color:${c.text};">
                ${esc(content.greeting)}
              </p>

              <p style="margin:10px 0 0;font-family:${FONT};font-size:16px;line-height:1.6;color:${c.textSoft};">
                ${content.intro}
              </p>
${notice}${button}${meta}${fallback}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:22px 24px 0;">
              <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${c.muted};">
                ${content.footer}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
