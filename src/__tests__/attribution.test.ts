import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTRIBUTION_FIELDS, resolveAttribution } from '../sync/attribution';
import type { HookContext } from '../types';

function ctx(headers: Record<string, string>): HookContext {
  return { headers: new Headers(headers) };
}

/** The cookie exactly as a browser sends it back after `JSON.stringify`. */
function attributionCookie(value: Record<string, unknown>, name = 'wraps_attribution') {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`;
}

describe('resolveAttribution — cookie', () => {
  it('reads a JSON cookie', () => {
    const cookie = attributionCookie({
      utm_source: 'reddit',
      utm_campaign: 'launch',
      landing_page: '/pricing',
    });

    expect(resolveAttribution(ctx({ cookie }))).toEqual({
      utm_source: 'reddit',
      utm_campaign: 'launch',
      landing_page: '/pricing',
    });
  });

  it('reads a query-string cookie', () => {
    const cookie = 'wraps_attribution=utm_source%3Dhn%26utm_medium%3Dsocial';

    expect(resolveAttribution(ctx({ cookie }))).toEqual({
      utm_source: 'hn',
      utm_medium: 'social',
    });
  });

  it('finds the cookie among others', () => {
    const cookie = [
      'better-auth.session_token=abc',
      attributionCookie({ utm_source: 'github' }),
      'theme=dark',
    ].join('; ');

    expect(resolveAttribution(ctx({ cookie }))).toEqual({ utm_source: 'github' });
  });

  it('reads a custom cookie name', () => {
    const cookie = attributionCookie({ utm_source: 'x' }, 'attr');

    expect(resolveAttribution(ctx({ cookie }))).toBeNull();
    expect(resolveAttribution(ctx({ cookie }), { cookieName: 'attr' })).toEqual({
      utm_source: 'x',
    });
  });

  it('takes headers from context.request when not hoisted', () => {
    const context: HookContext = {
      request: { headers: new Headers({ cookie: attributionCookie({ ref: 'partner' }) }) },
    };

    expect(resolveAttribution(context)).toEqual({ ref: 'partner' });
  });
});

describe('resolveAttribution — untrusted input', () => {
  it('drops keys outside the allowlist', () => {
    const cookie = attributionCookie({
      utm_source: 'reddit',
      plan: 'enterprise',
      isAdmin: true,
    });

    expect(resolveAttribution(ctx({ cookie }))).toEqual({ utm_source: 'reddit' });
  });

  it('keeps extra keys when the allowlist is extended', () => {
    const cookie = attributionCookie({ utm_source: 'reddit', partner_id: 'p_1' });

    expect(
      resolveAttribution(ctx({ cookie }), {
        fields: [...DEFAULT_ATTRIBUTION_FIELDS, 'partner_id'],
      })
    ).toEqual({ utm_source: 'reddit', partner_id: 'p_1' });
  });

  it('truncates oversized values', () => {
    const cookie = attributionCookie({ utm_campaign: 'a'.repeat(5000) });
    const resolved = resolveAttribution(ctx({ cookie }));

    expect(resolved?.utm_campaign).toHaveLength(512);
  });

  it('drops nested and empty values, and flattens primitives', () => {
    const cookie = attributionCookie({
      utm_source: { nested: 'object' },
      utm_medium: ['array'],
      utm_campaign: '   ',
      utm_content: 42,
      utm_term: null,
    });

    expect(resolveAttribution(ctx({ cookie }))).toEqual({ utm_content: '42' });
  });

  it('returns null for a malformed cookie instead of throwing', () => {
    expect(resolveAttribution(ctx({ cookie: 'wraps_attribution={not json' }))).toBeNull();
    expect(resolveAttribution(ctx({ cookie: 'wraps_attribution=%E0%A4%A' }))).toBeNull();
    expect(resolveAttribution(ctx({ cookie: 'wraps_attribution=' }))).toBeNull();
  });

  it('returns null when there is no context or no headers', () => {
    expect(resolveAttribution()).toBeNull();
    expect(resolveAttribution(null)).toBeNull();
    expect(resolveAttribution({ path: '/sign-up/email' })).toBeNull();
  });
});

describe('resolveAttribution — referer fallback', () => {
  it('reads UTM params off the referring page', () => {
    const context = ctx({ referer: 'https://acme.com/signup?utm_source=twitter&ref=friend' });

    expect(resolveAttribution(context)).toEqual({ utm_source: 'twitter', ref: 'friend' });
  });

  it('never records the referring URL itself as `referrer`', () => {
    const context = ctx({ referer: 'https://acme.com/signup?utm_source=twitter' });

    expect(resolveAttribution(context)).not.toHaveProperty('referrer');
  });

  it('only fills gaps the cookie left', () => {
    const context = ctx({
      cookie: attributionCookie({ utm_source: 'reddit' }),
      referer: 'https://acme.com/signup?utm_source=twitter&utm_medium=social',
    });

    expect(resolveAttribution(context)).toEqual({
      utm_source: 'reddit',
      utm_medium: 'social',
    });
  });

  it('can be turned off', () => {
    const context = ctx({ referer: 'https://acme.com/signup?utm_source=twitter' });

    expect(resolveAttribution(context, { fromReferer: false })).toBeNull();
  });

  it('ignores an unparseable referer', () => {
    expect(resolveAttribution(ctx({ referer: 'not-a-url' }))).toBeNull();
  });
});

describe('resolveAttribution — custom parse', () => {
  it('replaces every other source and skips the allowlist', () => {
    const context = ctx({ cookie: attributionCookie({ utm_source: 'reddit' }) });

    const resolved = resolveAttribution(context, {
      parse: (c) => ({ affiliate: c?.headers?.get('x-affiliate') ?? 'none' }),
    });

    expect(resolved).toEqual({ affiliate: 'none' });
  });

  it('returns null when the parser finds nothing', () => {
    expect(resolveAttribution(ctx({}), { parse: () => null })).toBeNull();
    expect(resolveAttribution(ctx({}), { parse: () => ({}) })).toBeNull();
  });
});
