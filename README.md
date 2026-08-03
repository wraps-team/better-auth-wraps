# @wraps.dev/better-auth

Better Auth plugin for [Wraps](https://wraps.dev).

Two things, both opt-in:

1. **Sync** — new signups become Wraps contacts and fire a `user.signed_up` event, so your welcome sequences and onboarding workflows run.
2. **Send** — drop-in senders for the transactional email Better Auth otherwise makes you wire by hand: verification, password reset, magic link, OTP, and organisation invites — delivered through **your own AWS SES account**.

You can use either half on its own. The email half needs no Wraps account at all.

## Install

```bash
npm install @wraps.dev/better-auth
# or
pnpm add @wraps.dev/better-auth
```

`@wraps.dev/email` is an optional peer dependency, only needed for the email half:

```bash
pnpm add @wraps.dev/email
```

## Quick start

```ts
// auth.ts
import { betterAuth } from 'better-auth';
import { wraps } from '@wraps.dev/better-auth';

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  plugins: [
    wraps({
      // Sync half — omit to disable
      apiKey: process.env.WRAPS_API_KEY,

      // Email half — omit to disable
      email: {
        from: 'Acme <auth@acme.com>',
        appName: 'Acme',
        brand: {
          logoUrl: 'https://acme.com/logo.png',
          primaryColor: '#4f46e5',
          supportEmail: 'help@acme.com',
        },
      },
    }),
  ],
});
```

That's it. New users are synced, and `sendVerificationEmail`, `sendResetPassword`, and `onPasswordReset` are wired for you.

### Client (optional)

```ts
import { createAuthClient } from 'better-auth/client';
import { wrapsClient } from '@wraps.dev/better-auth/client';

export const authClient = createAuthClient({ plugins: [wrapsClient()] });
```

Type inference only. Everything happens server-side and your API key never reaches the browser.

## Auth emails

The plugin fills in the senders it can reach. For the ones that belong to other plugins, build them once and pass them in:

```ts
import { wrapsAuthEmails } from '@wraps.dev/better-auth';
import { emailOTP, magicLink, organization } from 'better-auth/plugins';

const emails = wrapsAuthEmails({
  from: 'Acme <auth@acme.com>',
  appName: 'Acme',
  appUrl: 'https://app.acme.com', // used to build the invitation link
});

betterAuth({
  plugins: [
    magicLink({ sendMagicLink: emails.magicLink }),
    emailOTP({ sendVerificationOTP: emails.otp }),
    organization({ sendInvitationEmail: emails.invitation }),
  ],
});
```

Available senders: `verification`, `resetPassword`, `passwordChanged`, `magicLink`, `otp`, `invitation`.

### The plugin never overrides your config

Better Auth merges plugin options *under* your own, so anything you define wins. If you already have a `sendVerificationEmail`, the plugin leaves it alone. The senders it supplies are defaults that fill gaps.

It also never sets `emailAndPassword.enabled`. Configuring the email half will not turn on password auth for an app that did not ask for it.

### AWS credentials

Credentials follow the standard `@wraps.dev/email` resolution chain. Pass anything `WrapsEmailConfig` accepts through `ses`:

```ts
wrapsAuthEmails({
  from: 'auth@acme.com',
  ses: {
    region: 'us-east-1',
    roleArn: 'arn:aws:iam::123456789012:role/AcmeMail', // Vercel / GitHub Actions OIDC
  },
});
```

With nothing set, the AWS credential chain resolves as usual (env vars, `~/.aws/credentials`, instance role).

### Custom templates

The bundled templates are plain HTML with no React dependency, and carry no Wraps branding — they read as coming from your app. Override any of them:

```ts
wrapsAuthEmails({
  from: 'auth@acme.com',
  templates: {
    verification: ({ user, url, appName }) => ({
      subject: `Confirm your ${appName} account`,
      html: renderMyEmail({ user, url }),
      text: `Confirm: ${url}`,
    }),
  },
});
```

## Contact sync

On user creation the plugin upserts a contact and fires an event:

```
POST /v1/contacts/   { externalId: <user.id>, email, firstName, lastName, ... }
POST /v1/events/     { name: 'user.signed_up', contactId, properties: { method, provider } }
```

If the email already belongs to a contact — a newsletter subscriber converting, say — it patches that contact instead of failing. `properties.method` records how they signed up (`email`, `oauth`, `passkey`, `magic-link`, `otp`), with `provider` set for OAuth.

### Consent

New contacts are subscribed to **no topics** by default. A signup is a transactional relationship, not marketing consent. Set `topicSlugs` only when your signup form actually asks:

```ts
wraps({
  apiKey: process.env.WRAPS_API_KEY,
  topicSlugs: ['product-updates'],
});
```

### Attribution

Where a signup came from is known at the request, and gone by the time you query the contact. Turn it on and the plugin reads it off the signup request and stores it on both the contact and the event:

```ts
wraps({
  apiKey: process.env.WRAPS_API_KEY,
  attribution: true,
});
```

That's the whole setup. The contact gets `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ref`, `referrer`, `landing_page`, `timestamp`, `gclid`, `fbclid`, and `msclkid` — whichever are present — and so does the `user.signed_up` event, so a workflow can branch on the campaign that produced the signup.

It reads a `wraps_attribution` cookie holding either JSON or a query string. Set it wherever you already handle first touch — in Next.js, middleware is the usual place:

```ts
// middleware.ts — first touch wins, so don't overwrite an existing cookie
if (!request.cookies.has('wraps_attribution')) {
  response.cookies.set('wraps_attribution', JSON.stringify(params), { maxAge: 30 * 24 * 3600 });
}
```

No cookie is fine too: the plugin falls back to the query string of the page that submitted the signup, which covers a visitor who lands on `/signup?utm_source=hn` and signs up on the spot.

**Off by default,** because it writes browser-supplied data to your contact records, and that should be a decision rather than something that starts happening on upgrade.

**The key list is an allowlist, not a suggestion.** The cookie is browser-writable, so anyone can put anything in it. Only known keys are kept, values are flattened to strings and capped at 512 characters, and nothing from the cookie can shadow the `method`, `provider`, or `source` the plugin reports on the event. Extend it deliberately:

```ts
import { DEFAULT_ATTRIBUTION_FIELDS } from '@wraps.dev/better-auth';

attribution: {
  cookieName: 'acme_attr',
  fields: [...DEFAULT_ATTRIBUTION_FIELDS, 'partner_id'],
  fromReferer: false,   // cookie only
  event: false,         // contact only, keep the event lean
  parse: (context) => ({ affiliate: context?.headers?.get('x-affiliate') }),
}
```

`parse` replaces every other source and skips the allowlist — it's your code. If it throws, you get an `onError` with `stage: 'attribution'` and the signup carries on without attribution.

### Anything else off the request

`properties` and `shouldSync` both receive the Better Auth hook context, so anything on the request can shape the contact:

```ts
wraps({
  apiKey: process.env.WRAPS_API_KEY,
  properties: (user, context) => ({
    plan: 'free',
    invitedBy: context?.body?.inviteCode,
  }),
  shouldSync: (user, context) => context?.path !== '/admin/create-user',
});
```

`properties` wins over `attribution` on key collisions — explicit beats ambient.

## Options

```ts
wraps({
  // --- sync ---
  apiKey: process.env.WRAPS_API_KEY,
  baseUrl: 'https://api.wraps.dev',
  eventName: 'user.signed_up',        // or false to skip the event
  topicSlugs: [],
  emailStatus: 'active',
  attribution: false,                 // true, or { cookieName, fields, fromReferer, parse, contact, event }
  properties: (user, context) => ({ plan: 'free' }),
  shouldSync: (user, context) => !user.email.endsWith('@internal.acme.com'),
  syncOnUpdate: true,                 // patch the contact on email/name change
  syncOnDelete: false,                // or 'unsubscribe' | 'delete'

  // --- email ---
  email: {
    from: 'Acme <auth@acme.com>',
    appName: 'Acme',
    appUrl: 'https://app.acme.com',
    invitationUrl: ({ id }) => `https://app.acme.com/join/${id}`,
    replyTo: 'support@acme.com',
    configurationSetName: 'acme-auth',
    brand: { logoUrl, primaryColor, supportEmail, footerText },
    templates: { /* per-template overrides */ },
    ses: { /* WrapsEmailConfig passthrough */ },
  },

  // --- behaviour ---
  waitUntil: (promise) => ctx.waitUntil(promise),  // Vercel / Cloudflare
  onContactSynced: ({ userId, contactId, created }) => {},
  onError: (error, { stage }) => logger.warn({ error, stage }),
});
```

## Notes on correctness

**Every signup path is covered.** The plugin hangs off `databaseHooks.user.create.after`, not response-level `after` hooks. Better Auth skips `after` hooks on OAuth redirect responses, so a plugin that matches on `/callback/*` silently misses every Google and GitHub signup. Database hooks fire for all of them — including users created by an admin or by SCIM. Plugin hooks are additive, so your own `databaseHooks` still run.

**Sync work is awaited.** On Lambda the runtime freezes the moment the handler returns, so fire-and-forget background work never happens. Pass `waitUntil` if your platform has a real background primitive.

**Auth never fails because of us.** Every contact write and every send is wrapped. Failures go to `onError` and stop there — a Wraps outage or an SES throttle cannot break a signup.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## License

MIT
