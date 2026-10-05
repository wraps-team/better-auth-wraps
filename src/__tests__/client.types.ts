// Type-level regression test, checked by `pnpm typecheck` (tsconfig excludes *.test.ts).
//
// Inferring the client from the wide BetterAuthPlugin type used to make
// `signIn`/`signUp` disappear from the client once wrapsClient() was installed.
import { createAuthClient } from 'better-auth/client';
import { expectTypeOf } from 'vitest';
import { wrapsClient } from '../client';

const plain = createAuthClient({ baseURL: 'http://localhost:3000' });
const client = createAuthClient({
  baseURL: 'http://localhost:3000',
  plugins: [wrapsClient()],
});

expectTypeOf(client.signIn.email).toEqualTypeOf(plain.signIn.email);
expectTypeOf(client.signUp.email).toEqualTypeOf(plain.signUp.email);
expectTypeOf(client).toHaveProperty('useSession');
