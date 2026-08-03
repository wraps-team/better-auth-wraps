import type { WrapsAuthEmailBrand } from '../types';

const DEFAULT_PRIMARY_COLOR = '#4f46e5';

/**
 * Escape a value for interpolation into HTML.
 *
 * Everything these templates interpolate — display names, organisation names,
 * callback URLs — originates in request input, so nothing goes in raw.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a URL for use in an `href`.
 *
 * Also drops anything that is not http(s), so a poisoned callback URL cannot
 * turn into a `javascript:` link in the recipient's mail client.
 */
export function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return '#';
  }
  return escapeHtml(trimmed);
}

export interface LayoutOptions {
  brand: WrapsAuthEmailBrand;
  appName: string;
  previewText: string;
  heading: string;
  /** Body paragraphs. Each string is escaped and wrapped in its own <p>. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Large monospace code block, for OTP emails. */
  code?: string;
  /** Small print below the action, e.g. "this link expires in 1 hour". */
  footnote?: string;
}

function button(label: string, url: string, color: string): string {
  // Table-based so it renders in Outlook, which ignores padding on <a>.
  return `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0;">
          <tr>
            <td align="center" bgcolor="${escapeHtml(color)}" style="border-radius:6px;">
              <a href="${safeUrl(url)}" style="display:inline-block;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
            </td>
          </tr>
        </table>`;
}

/**
 * The single shared shell every bundled template renders through.
 *
 * Deliberately plain: these emails should read as coming from the app that
 * installed the plugin, not from Wraps. No Wraps branding appears in the output.
 */
export function renderLayout(options: LayoutOptions): { html: string; text: string } {
  const { brand, appName, previewText, heading, paragraphs, action, code, footnote } = options;
  const color = brand.primaryColor ?? DEFAULT_PRIMARY_COLOR;

  const logo = brand.logoUrl
    ? `<img src="${safeUrl(brand.logoUrl)}" alt="${escapeHtml(appName)}" height="32" style="height:32px;width:auto;margin-bottom:24px;display:block;" />`
    : `<div style="font-size:18px;font-weight:600;color:#111827;margin-bottom:24px;">${escapeHtml(appName)}</div>`;

  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(paragraph)}</p>`
    )
    .join('\n        ');

  const codeBlock = code
    ? `<div style="margin:32px 0;padding:16px;background:#f3f4f6;border-radius:6px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:6px;font-weight:600;color:#111827;">${escapeHtml(code)}</div>`
    : '';

  const actionBlock = action ? button(action.label, action.url, color) : '';

  const fallbackLink =
    action && safeUrl(action.url) !== '#'
      ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280;">Or paste this link into your browser:<br /><a href="${safeUrl(action.url)}" style="color:${escapeHtml(color)};word-break:break-all;">${safeUrl(action.url)}</a></p>`
      : '';

  const footnoteBlock = footnote
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#6b7280;">${escapeHtml(footnote)}</p>`
    : '';

  const support = brand.supportEmail
    ? `Questions? Reach us at <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${escapeHtml(color)};">${escapeHtml(brand.supportEmail)}</a>.`
    : '';
  const footerText = brand.footerText ? escapeHtml(brand.footerText) : '';
  const footerParts = [support, footerText].filter(Boolean).join('<br />');
  const footer = footerParts
    ? `<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#6b7280;">${footerParts}</div>`
    : '';

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f9fafb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            <tr>
              <td>
        ${logo}
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:600;color:#111827;">${escapeHtml(heading)}</h1>
        ${body}
        ${codeBlock}
        ${actionBlock}
        ${fallbackLink}
        ${footnoteBlock}
        ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textParts = [heading, '', ...paragraphs];
  if (code) {
    textParts.push('', code);
  }
  if (action) {
    textParts.push('', `${action.label}: ${action.url}`);
  }
  if (footnote) {
    textParts.push('', footnote);
  }
  if (brand.supportEmail) {
    textParts.push('', `Questions? Reach us at ${brand.supportEmail}.`);
  }
  if (brand.footerText) {
    textParts.push('', brand.footerText);
  }

  return { html, text: `${textParts.join('\n')}\n` };
}
