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

## Options

```ts
wraps({
  // --- sync ---
  apiKey: process.env.WRAPS_API_KEY,
  baseUrl: 'https://api.wraps.dev',
  eventName: 'user.signed_up',        // or false to skip the event
  topicSlugs: [],
  emailStatus: 'active',
  properties: (user) => ({ plan: 'free' }),
  shouldSync: (user) => !user.email.endsWith('@internal.acme.com'),
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
