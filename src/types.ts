/**
 * The subset of the Better Auth user record this plugin reads.
 *
 * Kept structural rather than importing Better Auth's `User` so the plugin
 * works across minor versions and with `additionalFields` extensions.
 */
export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean | null;
  [key: string]: unknown;
}

/** Where a failure happened, so `onError` handlers can route by stage. */
export type WrapsErrorStage = 'contact' | 'event' | 'email';

export interface WrapsErrorContext {
  stage: WrapsErrorStage;
  user?: { id: string; email: string };
}

/** Brand tokens applied to every bundled email template. */
export interface WrapsAuthEmailBrand {
  /** Absolute URL to a logo image shown at the top of each email. */
  logoUrl?: string;
  /** Accent colour for buttons and links. Defaults to a neutral indigo. */
  primaryColor?: string;
  /** Shown in the footer as the reply-to-a-human address. */
  supportEmail?: string;
  /** Appended to the footer, e.g. a postal address for CAN-SPAM. */
  footerText?: string;
}

/** A fully rendered email, ready to hand to SES. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Context every bundled template receives. */
export interface TemplateContext {
  appName: string;
  brand: WrapsAuthEmailBrand;
}

export interface VerificationTemplateInput extends TemplateContext {
  user: AuthUser;
  url: string;
}

export interface ResetPasswordTemplateInput extends TemplateContext {
  user: AuthUser;
  url: string;
}

export interface PasswordChangedTemplateInput extends TemplateContext {
  user: AuthUser;
}

export interface MagicLinkTemplateInput extends TemplateContext {
  email: string;
  url: string;
}

export type OtpType = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

export interface OtpTemplateInput extends TemplateContext {
  email: string;
  otp: string;
  type: OtpType;
}

export interface InvitationTemplateInput extends TemplateContext {
  email: string;
  url: string;
  organizationName: string;
  inviterName?: string;
}

/**
 * Per-template overrides. Each returns a fully rendered email, replacing the
 * bundled one entirely — the shared layout is not applied on top.
 */
export interface WrapsAuthEmailTemplates {
  verification?: (input: VerificationTemplateInput) => RenderedEmail;
  resetPassword?: (input: ResetPasswordTemplateInput) => RenderedEmail;
  passwordChanged?: (input: PasswordChangedTemplateInput) => RenderedEmail;
  magicLink?: (input: MagicLinkTemplateInput) => RenderedEmail;
  otp?: (input: OtpTemplateInput) => RenderedEmail;
  invitation?: (input: InvitationTemplateInput) => RenderedEmail;
}

/**
 * Configuration for the auth email senders.
 *
 * Every field beyond `from` is optional. AWS credentials follow the standard
 * `@wraps.dev/email` resolution chain — pass `client`, `roleArn`, `region`, or
 * `credentials` through `ses` to override it, or leave it empty and let the AWS
 * credential chain resolve.
 */
export interface WrapsAuthEmailOptions {
  /** Verified SES sender, e.g. `"Acme <auth@acme.com>"`. */
  from: string;
  /** Product name used in subject lines and body copy. Defaults to "your account". */
  appName?: string;
  /**
   * Base URL of your app, used to build the organisation invitation link.
   * Better Auth's `sendInvitationEmail` hands over an invitation id but no URL,
   * so one of `appUrl` or `invitationUrl` is required for `emails.invitation`.
   */
  appUrl?: string;
  /**
   * Build the accept-invitation URL yourself. Takes precedence over `appUrl`.
   */
  invitationUrl?: (data: { id: string; email: string; organizationName: string }) => string;
  /** Reply-To header applied to every auth email. */
  replyTo?: string;
  /** SES configuration set, for per-stream event tracking. */
  configurationSetName?: string;
  brand?: WrapsAuthEmailBrand;
  templates?: WrapsAuthEmailTemplates;
  /**
   * Passed straight to the `WrapsEmail` constructor. Accepts everything
   * `WrapsEmailConfig` does: `client`, `region`, `credentials`, `roleArn`.
   */
  ses?: Record<string, unknown>;
  /** Called when a send fails. The auth flow is never blocked by a send error. */
  onError?: (error: Error, context: WrapsErrorContext) => void;
}

/** Signup method inferred from the request path that created the user. */
export type SignupMethod = 'email' | 'oauth' | 'passkey' | 'magic-link' | 'otp' | 'unknown';

export interface ContactSyncedPayload {
  userId: string;
  email: string;
  contactId?: string;
  /** False when the contact already existed and was patched instead. */
  created: boolean;
}

export interface WrapsPluginOptions {
  /**
   * Wraps Platform API key. Omit to disable contact sync entirely and use the
   * plugin only for auth emails.
   */
  apiKey?: string;
  /** Platform API base URL. Defaults to `https://api.wraps.dev`. */
  baseUrl?: string;

  /**
   * Event fired after the contact is upserted, so event-triggered workflows
   * run. Set to `false` to skip the event and only sync the contact.
   *
   * @default 'user.signed_up'
   */
  eventName?: string | false;

  /**
   * Topic slugs the new contact is subscribed to.
   *
   * Left empty by default on purpose: a signup is a transactional relationship,
   * not marketing consent. Only set this when your signup form actually asks.
   */
  topicSlugs?: string[];

  /** Email subscription status for newly created contacts. @default 'active' */
  emailStatus?: 'active' | 'unsubscribed';

  /** Extra properties stored on the contact record. */
  properties?: (user: AuthUser) => Record<string, unknown>;

  /** Return false to skip syncing a given user (e.g. internal test accounts). */
  shouldSync?: (user: AuthUser) => boolean | Promise<boolean>;

  /**
   * Patch the contact when the user's email or name changes.
   * @default true
   */
  syncOnUpdate?: boolean;

  /**
   * What to do with the contact when the user is deleted. `'unsubscribe'`
   * marks the contact unsubscribed; `'delete'` removes it outright.
   * @default false
   */
  syncOnDelete?: false | 'unsubscribe' | 'delete';

  /** Auth email senders. Omit to disable the email half. */
  email?: WrapsAuthEmailOptions;

  /**
   * Hand the sync promise to a platform-provided background primitive instead
   * of awaiting it inline — e.g. Vercel's or Cloudflare's `waitUntil`.
   *
   * Without this the plugin awaits. Fire-and-forget is not a safe default:
   * on Lambda the runtime freezes the moment the handler returns and the sync
   * silently never happens.
   */
  waitUntil?: (promise: Promise<unknown>) => void;

  /** Called after a contact is created or patched. */
  onContactSynced?: (payload: ContactSyncedPayload) => void | Promise<void>;

  /** Called on any failure. Failures never propagate into the auth flow. */
  onError?: (error: Error, context: WrapsErrorContext) => void;
}
