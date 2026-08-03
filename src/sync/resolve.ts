import type { AuthUser, HookContext, SignupMethod } from '../types';

export type { HookContext } from '../types';

/**
 * Split a Better Auth display name into first/last.
 *
 * Everything after the first space becomes the last name, so "Ada King
 * Lovelace" yields `{ firstName: 'Ada', lastName: 'King Lovelace' }`.
 */
export function splitName(name?: string | null): {
  firstName?: string;
  lastName?: string;
} {
  const trimmed = name?.trim();
  if (!trimmed) {
    return {};
  }

  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { firstName: trimmed };
  }

  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1).trim() || undefined,
  };
}

/**
 * Infer how a user signed up from the endpoint that created them.
 *
 * Mirrors Better Auth's own `last-login-method` resolver so the values line up
 * with what that plugin stores.
 */
export function resolveSignupMethod(context?: HookContext | null): {
  method: SignupMethod;
  provider?: string;
} {
  const path = context?.path;
  if (!path) {
    return { method: 'unknown' };
  }

  if (path.startsWith('/callback/') || path.startsWith('/oauth2/callback/')) {
    const provider = context?.params?.id ?? context?.params?.providerId ?? path.split('/').pop();
    return { method: 'oauth', provider: provider || undefined };
  }

  if (path === '/sign-up/email' || path === '/sign-in/email') {
    return { method: 'email' };
  }

  if (path.includes('/passkey/')) {
    return { method: 'passkey' };
  }

  if (path.startsWith('/magic-link/') || path.startsWith('/sign-in/magic-link')) {
    return { method: 'magic-link' };
  }

  if (path.includes('/email-otp/') || path.startsWith('/sign-in/email-otp')) {
    return { method: 'otp' };
  }

  return { method: 'unknown' };
}

/** Contact fields derived from a user record, minus anything undefined. */
export function contactFieldsFromUser(user: AuthUser): {
  externalId: string;
  email: string;
  firstName?: string;
  lastName?: string;
} {
  const { firstName, lastName } = splitName(user.name);
  return {
    externalId: user.id,
    email: user.email,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  };
}
