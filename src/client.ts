import type { BetterAuthClientPlugin } from 'better-auth/client';

/**
 * Wraps client plugin for Better Auth.
 *
 * Type inference only — contact sync and email delivery both happen entirely
 * on the server, and the Wraps API key must never reach the browser.
 *
 * @example
 * ```ts
 * import { createAuthClient } from 'better-auth/client';
 * import { wrapsClient } from '@wraps.dev/better-auth/client';
 *
 * export const authClient = createAuthClient({ plugins: [wrapsClient()] });
 * ```
 */
// Deliberately narrow, not `WrapsPlugin`. wraps() is declared as the wide
// BetterAuthPlugin (see plugin.ts), and inferring the client from that open
// type collapses it: `signIn`, `signUp` etc. vanish. The plugin adds no
// endpoints or schema, so there is nothing for the client to infer.
type WrapsServerPlugin = { id: 'wraps' };

export const wrapsClient = () => {
  return {
    id: 'wraps',
    $InferServerPlugin: {} as WrapsServerPlugin,
  } satisfies BetterAuthClientPlugin;
};
