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

/** Anything that reads a header by name — `Headers`, or a stand-in in tests. */
export interface HeaderLike {
  get(name: string): string | null | undefined;
}

/**
 * Minimal shape of the hook context Better Auth passes to database hooks.
 *
 * Typed structurally because the context is `GenericEndpointContext | undefined`
 * and its shape varies by the endpoint that triggered the write — and because a
 * plugin should not break when Better Auth widens it.
 */
export interface HookContext {
  path?: string;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  /** Request headers. Where the attribution cookie and Referer come from. */
  headers?: HeaderLike | null;
  /** Some endpoints carry the raw request instead of hoisting the headers. */
  request?: { headers?: HeaderLike | null } | null;
}

/** Where a failure happened, so `onError` handlers can route by stage. */
export type WrapsErrorStage = 'contact' | 'event' | 'email' | 'attribution';

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

/**
 * How marketing attribution is pulled off the signup request.
 *
 * Defaults read a `wraps_attribution` cookie holding either JSON or a query
 * string, keep the standard UTM/click-id keys, and merge them into both the
 * contact record and the signup event.
 */
export interface AttributionOptions {
  /** Cookie holding the attribution payload. @default 'wraps_attribution' */
  cookieName?: string;

  /**
   * Keys to keep. Replaces the default allowlist outright — spread
   * `DEFAULT_ATTRIBUTION_FIELDS` to extend it instead.
   *
   * The list matters: the cookie is browser-writable, so without it a visitor
   * could stamp arbitrary fields onto their own contact record.
   */
  fields?: string[];

  /**
   * When the cookie is missing a field, fall back to the query string of the
   * page that submitted the request. Never records the Referer itself as
   * `referrer` — on a signup that is your own form, not the visitor's origin.
   *
   * @default true
   */
  fromReferer?: boolean;

  /**
   * Extract attribution yourself. Takes precedence over every other option,
   * and its keys are not filtered through `fields`.
   */
  parse?: (context?: HookContext | null) => Record<string, unknown> | null | undefined;

  /** Merge into the contact's properties. @default true */
  contact?: boolean;

  /** Merge into the signup event's properties. @default true */
  event?: boolean;
}

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

  /**
   * Capture marketing attribution from the signup request and store it on the
   * contact and the signup event. `true` uses the defaults.
   *
   * Off by default: it writes browser-supplied data to your contact records,
   * which should be a decision rather than something that starts happening on
   * upgrade.
   *
   * @default false
   */
  attribution?: boolean | AttributionOptions;

  /**
   * Extra properties stored on the contact record.
   *
   * Receives the hook context, so anything on the request — cookies, headers,
   * the endpoint path — can shape the contact. Wins over `attribution` on key
   * collisions.
   */
  properties?: (user: AuthUser, context?: HookContext | null) => Record<string, unknown>;

  /** Return false to skip syncing a given user (e.g. internal test accounts). */
  shouldSync?: (user: AuthUser, context?: HookContext | null) => boolean | Promise<boolean>;

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
