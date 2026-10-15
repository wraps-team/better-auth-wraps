// Type-level tests, checked by `pnpm typecheck` (tsconfig excludes *.test.ts).
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins';
import { expectTypeOf } from 'vitest';
import type { WrapsAuthEmails } from '../email/senders';
import { wraps } from '../plugin';

// With email config, the senders are there without a non-null assertion.
const withEmail = wraps({ email: { from: 'auth@acme.com', appUrl: 'https://app.acme.com' } });
expectTypeOf(withEmail.emails).toEqualTypeOf<WrapsAuthEmails>();

// Without it, they may be missing.
expectTypeOf(wraps().emails).toEqualTypeOf<WrapsAuthEmails | undefined>();
expectTypeOf(wraps({ apiKey: 'k' }).emails).toEqualTypeOf<WrapsAuthEmails | undefined>();

// The extra property must not cost the app its inferred API.
const auth = betterAuth({
  emailAndPassword: { enabled: true },
  plugins: [withEmail, organization({ sendInvitationEmail: withEmail.emails.invitation })],
});
expectTypeOf(auth.api).toHaveProperty('signUpEmail');
expectTypeOf(auth.api).toHaveProperty('createInvitation');
