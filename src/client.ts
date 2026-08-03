import type { BetterAuthClientPlugin } from 'better-auth/client';
import type { WrapsPlugin } from './plugin';

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
export const wrapsClient = () => {
  return {
    id: 'wraps',
    $InferServerPlugin: {} as WrapsPlugin,
  } satisfies BetterAuthClientPlugin;
};
