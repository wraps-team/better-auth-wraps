import type { AttributionOptions, HeaderLike, HookContext } from '../types';

/**
 * Attribution keys captured by default.
 *
 * An allowlist, not a passthrough. The cookie is written and readable by the
 * browser, so anyone can put anything in it — without a fixed key set a visitor
 * could stamp arbitrary fields onto their own contact record, and from there
 * into segment filters and template variables.
 *
 * Spread it to extend rather than replace:
 * `fields: [...DEFAULT_ATTRIBUTION_FIELDS, 'partner_id']`.
 */
export const DEFAULT_ATTRIBUTION_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
  'referrer',
  'landing_page',
  'timestamp',
  'gclid',
  'fbclid',
  'msclkid',
];

/** Cookie the plugin reads when `cookieName` is not set. */
export const DEFAULT_ATTRIBUTION_COOKIE = 'wraps_attribution';

/** Longest value kept for a single field. Longer values are truncated. */
const MAX_VALUE_LENGTH = 512;

/** The request headers, wherever this endpoint context happens to keep them. */
function headersOf(context?: HookContext | null): HeaderLike | undefined {
  return context?.headers ?? context?.request?.headers ?? undefined;
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(`${name}=`)) {
      return cookie.slice(name.length + 1);
    }
  }
  return undefined;
}

/**
 * Decode a cookie written either as JSON (`{"utm_source":"x"}`) or as a query
 * string (`utm_source=x&utm_medium=y`). Both are common; neither is worth
 * making the caller declare.
 */
function parseCookieValue(raw: string): Record<string, unknown> | null {
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding. Fall back to the raw value rather than
    // dropping attribution that might still parse.
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * Query parameters on the page that submitted the request.
 *
 * Only the query is read. The Referer itself is not recorded as `referrer`:
 * on a signup it points at your own form, which is not where the visitor came
 * from, and writing it there would quietly corrupt the field.
 */
function refererParams(context?: HookContext | null): Record<string, unknown> | null {
  const referer = headersOf(context)?.get('referer');
  if (!referer) {
    return null;
  }

  try {
    return Object.fromEntries(new URL(referer).searchParams);
  } catch {
    return null;
  }
}

/**
 * Coerce to flat strings and drop anything empty, nested, or oversized.
 *
 * With `fields`, only those keys survive. Without it — the custom `parse` path
 * — every key is kept, because the developer wrote the parser.
 */
function sanitize(source: Record<string, unknown>, fields?: string[]): Record<string, string> {
  const keys = fields ?? Object.keys(source);
  const result: Record<string, string> = {};

  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || typeof value === 'object') {
      continue;
    }

    const text = String(value).trim();
    if (!text) {
      continue;
    }

    result[key] = text.length > MAX_VALUE_LENGTH ? text.slice(0, MAX_VALUE_LENGTH) : text;
  }

  return result;
}

/**
 * Pull marketing attribution off the request that created the user.
 *
 * Cookie first, then the referring page's query string for gaps. Returns null
 * when there is nothing to record, so callers can skip the merge entirely.
 *
 * Never throws on its own — a signup must not fail because a cookie was
 * malformed. A custom `parse` is the caller's code and is left to propagate.
 */
export function resolveAttribution(
  context?: HookContext | null,
  options: AttributionOptions = {}
): Record<string, string> | null {
  if (options.parse) {
    const parsed = options.parse(context);
    const custom = parsed ? sanitize(parsed) : {};
    return Object.keys(custom).length > 0 ? custom : null;
  }

  const fields = options.fields ?? DEFAULT_ATTRIBUTION_FIELDS;
  const cookieHeader = headersOf(context)?.get('cookie');
  const raw = cookieHeader
    ? readCookie(cookieHeader, options.cookieName ?? DEFAULT_ATTRIBUTION_COOKIE)
    : undefined;
  const cookie = raw ? parseCookieValue(raw) : null;

  const attribution = cookie ? sanitize(cookie, fields) : {};

  // The cookie holds first-touch and always wins. The referring URL only fills
  // gaps, for apps that never set a cookie at all.
  if (options.fromReferer !== false) {
    const referer = refererParams(context);
    if (referer) {
      for (const [key, value] of Object.entries(sanitize(referer, fields))) {
        if (!(key in attribution)) {
          attribution[key] = value;
        }
      }
    }
  }

  return Object.keys(attribution).length > 0 ? attribution : null;
}
