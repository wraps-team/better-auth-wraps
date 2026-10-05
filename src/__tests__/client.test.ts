import { createAuthClient } from 'better-auth/client';
import { describe, expect, it } from 'vitest';
import { wrapsClient } from '../client';

// Type-level guarantees live in client.types.ts (checked by `pnpm typecheck`).
describe('wrapsClient', () => {
  it('has the wraps id', () => {
    expect(wrapsClient().id).toBe('wraps');
  });

  it('leaves the base client API intact at runtime', () => {
    const client = createAuthClient({
      baseURL: 'http://localhost:3000',
      plugins: [wrapsClient()],
    });
    expect(typeof client.signIn.email).toBe('function');
  });
});
