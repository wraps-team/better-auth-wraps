import { describe, expect, it } from 'vitest';
import { contactFieldsFromUser, resolveSignupMethod, splitName } from '../sync/resolve';

describe('splitName', () => {
  it('returns nothing for empty input', () => {
    expect(splitName(undefined)).toEqual({});
    expect(splitName(null)).toEqual({});
    expect(splitName('   ')).toEqual({});
  });

  it('treats a single token as a first name', () => {
    expect(splitName('Ada')).toEqual({ firstName: 'Ada' });
  });

  it('puts everything after the first space into the last name', () => {
    expect(splitName('Ada King Lovelace')).toEqual({
      firstName: 'Ada',
      lastName: 'King Lovelace',
    });
  });

  it('collapses trailing whitespace rather than emitting an empty last name', () => {
    expect(splitName('Ada  ')).toEqual({ firstName: 'Ada' });
  });
});

describe('resolveSignupMethod', () => {
  it('reads the provider out of an OAuth callback path', () => {
    expect(resolveSignupMethod({ path: '/callback/google' })).toEqual({
      method: 'oauth',
      provider: 'google',
    });
  });

  it('prefers the route param over the path segment', () => {
    expect(resolveSignupMethod({ path: '/callback/:id', params: { id: 'github' } })).toEqual({
      method: 'oauth',
      provider: 'github',
    });
  });

  it('handles generic oauth2 callbacks', () => {
    expect(resolveSignupMethod({ path: '/oauth2/callback/okta' })).toEqual({
      method: 'oauth',
      provider: 'okta',
    });
  });

  it('identifies email, passkey, magic link and otp paths', () => {
    expect(resolveSignupMethod({ path: '/sign-up/email' }).method).toBe('email');
    expect(resolveSignupMethod({ path: '/passkey/verify-registration' }).method).toBe('passkey');
    expect(resolveSignupMethod({ path: '/magic-link/verify' }).method).toBe('magic-link');
    expect(resolveSignupMethod({ path: '/email-otp/verify-email' }).method).toBe('otp');
  });

  it('falls back to unknown when there is no context', () => {
    expect(resolveSignupMethod(undefined)).toEqual({ method: 'unknown' });
    expect(resolveSignupMethod({}).method).toBe('unknown');
    expect(resolveSignupMethod({ path: '/some/other/route' }).method).toBe('unknown');
  });
});

describe('contactFieldsFromUser', () => {
  it('maps the better-auth id onto externalId', () => {
    expect(
      contactFieldsFromUser({ id: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' })
    ).toEqual({
      externalId: 'usr_1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
  });

  it('omits name fields entirely when the user has no name', () => {
    const fields = contactFieldsFromUser({ id: 'usr_1', email: 'ada@example.com' });
    expect(fields).toEqual({ externalId: 'usr_1', email: 'ada@example.com' });
    expect('firstName' in fields).toBe(false);
  });
});
