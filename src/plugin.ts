import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { type WrapsAuthEmails, wrapsAuthEmails } from './email/senders';
import { createContactSync } from './sync/contact';
import type { HookContext } from './sync/resolve';
import type { AuthUser, WrapsAuthEmailOptions, WrapsPluginOptions } from './types';

/**
 * The plugin, plus the auth email senders it built.
 *
 * `emails` covers the senders the plugin can't fill in itself because they
 * belong to other plugins' options: organization invitations, magic links and
 * OTP. Pass them in from here so every auth email shares one SES client.
 */
// Kept as an intersection with the wide BetterAuthPlugin, not an inferred
// type, for the same reason wraps() is declared: see the note below.
export type WrapsPlugin = BetterAuthPlugin & {
  /** Undefined unless `email` is configured. */
  emails: WrapsAuthEmails | undefined;
};

/**
 * Better Auth plugin for Wraps.
 *
 * Two independent halves, both opt-in:
 *
 * - **Sync** (`apiKey`): upserts a Wraps contact on signup and fires a
 *   `user.signed_up` event so your workflows run.
 * - **Email** (`email`): supplies the transactional senders Better Auth
 *   otherwise makes you hand-roll, delivered through your own AWS SES account.
 *
 * @example
 * ```ts
 * const plugin = wraps({
 *   apiKey: process.env.WRAPS_API_KEY,
 *   email: { from: 'Acme <auth@acme.com>', appName: 'Acme', appUrl: 'https://app.acme.com' },
 * });
 *
 * export const auth = betterAuth({
 *   plugins: [plugin, organization({ sendInvitationEmail: plugin.emails.invitation })],
 * });
 * ```
 */
// Declared, not `satisfies`: an inferred return type gets inlined into the
// published .d.ts against whatever better-auth we built with, and stops
// matching the consumer's BetterAuthPlugin on the next minor (1.7.3 did it).
export function wraps(
  options: WrapsPluginOptions & { email: WrapsAuthEmailOptions }
): WrapsPlugin & { emails: WrapsAuthEmails };
export function wraps(options?: WrapsPluginOptions): WrapsPlugin;
export function wraps(options: WrapsPluginOptions = {}): WrapsPlugin {
  const sync = options.apiKey ? createContactSync(options) : null;
  const emails = options.email
    ? wrapsAuthEmails({ onError: options.onError, ...options.email })
    : null;

  /**
   * Run background work without letting it break authentication.
   *
   * Awaited by default. Fire-and-forget is not safe here: on Lambda the
   * runtime freezes the instant the handler returns, so an un-awaited sync
   * silently never happens. `waitUntil` is the opt-out for platforms that
   * provide a real background primitive.
   */
  async function run(work: Promise<unknown>): Promise<void> {
    if (options.waitUntil) {
      options.waitUntil(work);
      return;
    }
    await work;
  }

  return {
    id: 'wraps',
    emails: emails ?? undefined,

    init() {
      return {
        options: {
          // Better Auth merges plugin-supplied options with `defu(userOptions,
          // pluginOptions)` — the app's own config sits on the left and wins.
          // So these are defaults that fill gaps, never overrides: an app that
          // already defines `sendVerificationEmail` keeps its own.
          //
          // `emailAndPassword.enabled` is deliberately absent. It is required
          // by the type but not by the merge, and setting it would switch on
          // password auth for an app that only wanted the senders.
          ...(emails
            ? ({
                emailVerification: {
                  sendVerificationEmail: async (data: { user: AuthUser; url: string }) => {
                    await emails.verification(data);
                  },
                },
                emailAndPassword: {
                  sendResetPassword: async (data: { user: AuthUser; url: string }) => {
                    await emails.resetPassword(data);
                  },
                  onPasswordReset: async (data: { user: AuthUser }) => {
                    await emails.passwordChanged(data);
                  },
                },
              } as unknown as Partial<BetterAuthOptions>)
            : {}),

          // Database hooks rather than response-level `after` hooks on purpose.
          // Better Auth skips `after` hooks on OAuth redirect responses, so a
          // path-matching plugin misses every Google and GitHub signup. These
          // fire for every creation path, including admin- and SCIM-created
          // users. Plugin hooks are additive — the app's own `databaseHooks`
          // still run.
          ...(sync
            ? {
                databaseHooks: {
                  user: {
                    create: {
                      after: async (user: AuthUser, context?: HookContext | null) => {
                        await run(sync.onUserCreated(user, context));
                      },
                    },
                    ...(options.syncOnUpdate === false
                      ? {}
                      : {
                          update: {
                            after: async (user: AuthUser) => {
                              await run(sync.onUserUpdated(user));
                            },
                          },
                        }),
                    ...(options.syncOnDelete
                      ? {
                          delete: {
                            after: async (user: AuthUser) => {
                              await run(sync.onUserDeleted(user));
                            },
                          },
                        }
                      : {}),
                  },
                },
              }
            : {}),
        },
      };
    },
  };
}
