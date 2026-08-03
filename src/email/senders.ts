import type {
  AuthUser,
  OtpType,
  RenderedEmail,
  WrapsAuthEmailBrand,
  WrapsAuthEmailOptions,
} from '../types';
import {
  invitationTemplate,
  magicLinkTemplate,
  otpTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verificationTemplate,
} from './templates';

/** Minimal structural view of the `WrapsEmail` surface this module uses. */
interface EmailSender {
  send(params: Record<string, unknown>): Promise<unknown>;
}

/**
 * Better Auth's `sendInvitationEmail` payload, narrowed to what we render.
 * Structural rather than imported so this package does not depend on the
 * organization plugin being installed.
 */
export interface InvitationData {
  id: string;
  email: string;
  organization: { name: string };
  inviter?: { user?: { name?: string | null } };
}

export interface WrapsAuthEmails {
  /** Plug into `emailVerification.sendVerificationEmail`. */
  verification: (data: { user: AuthUser; url: string }) => Promise<void>;
  /** Plug into `emailAndPassword.sendResetPassword`. */
  resetPassword: (data: { user: AuthUser; url: string }) => Promise<void>;
  /** Plug into `emailAndPassword.onPasswordReset`. */
  passwordChanged: (data: { user: AuthUser }) => Promise<void>;
  /** Plug into `magicLink({ sendMagicLink })`. */
  magicLink: (data: { email: string; url: string }) => Promise<void>;
  /** Plug into `emailOTP({ sendVerificationOTP })`. */
  otp: (data: { email: string; otp: string; type: OtpType }) => Promise<void>;
  /** Plug into `organization({ sendInvitationEmail })`. */
  invitation: (data: InvitationData) => Promise<void>;
}

/**
 * Build the auth transactional senders, backed by your own AWS SES account.
 *
 * Every sender swallows its own failures and reports them through `onError`.
 * A mail outage must not turn into a failed signup.
 *
 * @example
 * ```ts
 * const emails = wrapsAuthEmails({ from: 'Acme <auth@acme.com>', appName: 'Acme' });
 *
 * betterAuth({
 *   emailVerification: { sendVerificationEmail: emails.verification },
 *   emailAndPassword: { sendResetPassword: emails.resetPassword },
 *   plugins: [magicLink({ sendMagicLink: emails.magicLink })],
 * });
 * ```
 */
export function wrapsAuthEmails(options: WrapsAuthEmailOptions): WrapsAuthEmails {
  const appName = options.appName ?? 'your account';
  const brand: WrapsAuthEmailBrand = options.brand ?? {};
  const templates = options.templates ?? {};

  let clientPromise: Promise<EmailSender> | undefined;

  /**
   * `@wraps.dev/email` is an optional peer dependency, imported lazily so apps
   * using only the contact-sync half never pull the AWS SDK into their bundle.
   */
  async function getClient(): Promise<EmailSender> {
    if (!clientPromise) {
      clientPromise = import('@wraps.dev/email').then((mod) => {
        const WrapsEmail = (mod as unknown as { WrapsEmail: new (config?: unknown) => EmailSender })
          .WrapsEmail;
        return new WrapsEmail(options.ses ?? {});
      });
    }
    return clientPromise;
  }

  function report(error: unknown, email: string) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    if (options.onError) {
      options.onError(wrapped, { stage: 'email', user: { id: '', email } });
      return;
    }
    // No handler configured. Surfacing it beats a silent drop — a verification
    // email that never arrives looks like a broken product, not a broken send.
    console.error(`[@wraps.dev/better-auth] failed to send auth email to ${email}:`, wrapped);
  }

  async function deliver(to: string, rendered: RenderedEmail): Promise<void> {
    try {
      const client = await getClient();
      await client.send({
        from: options.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options.configurationSetName
          ? { configurationSetName: options.configurationSetName }
          : {}),
      });
    } catch (error) {
      report(error, to);
    }
  }

  return {
    async verification({ user, url }) {
      const render = templates.verification ?? verificationTemplate;
      await deliver(user.email, render({ user, url, appName, brand }));
    },

    async resetPassword({ user, url }) {
      const render = templates.resetPassword ?? resetPasswordTemplate;
      await deliver(user.email, render({ user, url, appName, brand }));
    },

    async passwordChanged({ user }) {
      const render = templates.passwordChanged ?? passwordChangedTemplate;
      await deliver(user.email, render({ user, appName, brand }));
    },

    async magicLink({ email, url }) {
      const render = templates.magicLink ?? magicLinkTemplate;
      await deliver(email, render({ email, url, appName, brand }));
    },

    async otp({ email, otp, type }) {
      const render = templates.otp ?? otpTemplate;
      await deliver(email, render({ email, otp, type, appName, brand }));
    },

    async invitation(data) {
      const organizationName = data.organization?.name ?? 'the team';

      const url = options.invitationUrl
        ? options.invitationUrl({ id: data.id, email: data.email, organizationName })
        : options.appUrl
          ? `${options.appUrl.replace(/\/$/, '')}/accept-invitation/${data.id}`
          : undefined;

      if (!url) {
        // Sending an invitation with a dead link is worse than not sending it:
        // the recipient burns their one moment of intent on a 404.
        report(
          new Error(
            'Cannot send an invitation email without a link. Set `appUrl` or `invitationUrl` on the email options.'
          ),
          data.email
        );
        return;
      }

      const render = templates.invitation ?? invitationTemplate;
      await deliver(
        data.email,
        render({
          email: data.email,
          url,
          organizationName,
          ...(data.inviter?.user?.name ? { inviterName: data.inviter.user.name } : {}),
          appName,
          brand,
        })
      );
    },
  };
}
