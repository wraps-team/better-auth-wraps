import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wraps } from '../plugin';
import type { WrapsPluginOptions } from '../types';

interface CapturedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

let calls: CapturedCall[] = [];
let respond: (call: CapturedCall) => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Capture every Wraps API request the plugin makes.
 *
 * openapi-fetch dispatches a `Request`, so read the body off a clone rather
 * than out of the init object.
 */
function stubFetch() {
  calls = [];
  respond = (call) => {
    if (call.path.startsWith('/v1/contacts/')) {
      return json({ id: 'con_1', email: 'ada@example.com' }, call.method === 'POST' ? 201 : 200);
    }
    return json({
      success: true,
      contactCreated: false,
      workflowsTriggered: 1,
      executionsResumed: 0,
    });
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const raw = await request.clone().text();
      const call: CapturedCall = {
        method: request.method,
        path: new global.URL(request.url).pathname,
        body: raw ? JSON.parse(raw) : undefined,
      };
      calls.push(call);
      return respond(call);
    })
  );
}

function makeAuth(options: WrapsPluginOptions = { apiKey: 'wraps_test' }) {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-value-at-least-32-characters-long',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    plugins: [wraps(options)],
  });
}

const SIGNUP = {
  email: 'ada@example.com',
  password: 'correct-horse-battery-staple',
  name: 'Ada Lovelace',
};

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

describe('wraps plugin — email signup', () => {
  it('creates a contact and fires the signup event', async () => {
    const auth = makeAuth();

    const result = await auth.api.signUpEmail({ body: SIGNUP });
    expect(result.user.email).toBe('ada@example.com');

    const contactCall = calls.find((c) => c.method === 'POST' && c.path === '/v1/contacts/');
    expect(contactCall?.body).toMatchObject({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      emailStatus: 'active',
    });
    expect(contactCall?.body?.externalId).toBe(result.user.id);

    const eventCall = calls.find((c) => c.path === '/v1/events/');
    expect(eventCall?.body).toMatchObject({
      name: 'user.signed_up',
      contactId: 'con_1',
      properties: { method: 'email', source: 'better-auth' },
    });
  });

  it('sends the API key as a bearer token and never in the body', async () => {
    const auth = makeAuth({ apiKey: 'wraps_supersecret' });
    await auth.api.signUpEmail({ body: SIGNUP });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.headers.get('Authorization')).toBe('Bearer wraps_supersecret');
    expect(JSON.stringify(calls)).not.toContain('wraps_supersecret');
  });

  it('does not call the API at all when no apiKey is configured', async () => {
    const auth = makeAuth({});
    await auth.api.signUpEmail({ body: SIGNUP });

    expect(calls).toHaveLength(0);
  });
});

describe('wraps plugin — signup paths other than /sign-up/email', () => {
  it('still syncs when the user is created outside the email endpoint', async () => {
    // This is the whole reason the plugin hangs off databaseHooks. Better Auth
    // skips response-level `after` hooks on OAuth redirect responses, so a
    // plugin that matches on `/callback/*` misses every social signup. Creating
    // the user straight through the internal adapter stands in for any of those
    // non-`/sign-up/email` paths.
    const auth = makeAuth();
    const ctx = await auth.$context;

    await ctx.internalAdapter.createUser({
      email: 'grace@example.com',
      name: 'Grace Hopper',
      emailVerified: true,
    });

    const contactCall = calls.find((c) => c.method === 'POST' && c.path === '/v1/contacts/');
    expect(contactCall?.body).toMatchObject({
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
    });
  });
});

describe('wraps plugin — failure isolation', () => {
  it('lets the signup succeed when the Wraps API is down', async () => {
    const onError = vi.fn();
    const auth = makeAuth({ apiKey: 'wraps_test', onError });
    respond = () => json({ error: 'Service unavailable' }, 503);

    const result = await auth.api.signUpEmail({ body: SIGNUP });

    expect(result.user.email).toBe('ada@example.com');
    expect(result.token).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [Error, { stage: string }])[1].stage).toBe('contact');
  });

  it('lets the signup succeed when the transport itself fails', async () => {
    const onError = vi.fn();
    const auth = makeAuth({ apiKey: 'wraps_test', onError });
    // Thrown from inside the already-installed stub: openapi-fetch captures
    // `globalThis.fetch` when the client is constructed, so re-stubbing it now
    // would not reach the client the plugin already built.
    respond = () => {
      throw new Error('ECONNREFUSED');
    };

    const result = await auth.api.signUpEmail({ body: SIGNUP });

    expect(result.user.email).toBe('ada@example.com');
    expect(onError).toHaveBeenCalled();
    expect((onError.mock.calls[0] as [Error, unknown])[0].message).toContain('ECONNREFUSED');
  });

  it('reconciles with a PATCH when the contact already exists', async () => {
    const onError = vi.fn();
    const auth = makeAuth({ apiKey: 'wraps_test', onError });
    respond = (call) => {
      if (call.method === 'POST' && call.path === '/v1/contacts/') {
        return json({ error: 'Contact with this email already exists' }, 409);
      }
      if (call.path.startsWith('/v1/contacts/')) {
        return json({ id: 'con_existing' });
      }
      return json({
        success: true,
        contactCreated: false,
        workflowsTriggered: 0,
        executionsResumed: 0,
      });
    };

    await auth.api.signUpEmail({ body: SIGNUP });

    // Addressed by the field that collided. openapi-fetch percent-encodes the
    // path param on the wire; the API decodes it back before resolving, so the
    // `@` survives the round trip.
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.path).toBe('/v1/contacts/ada%40example.com');
    expect(decodeURIComponent(patch?.path ?? '')).toBe('/v1/contacts/ada@example.com');
    expect(onError).not.toHaveBeenCalled();

    const eventCall = calls.find((c) => c.path === '/v1/events/');
    expect(eventCall?.body?.contactId).toBe('con_existing');
  });
});

describe('wraps plugin — waitUntil', () => {
  it('hands the sync promise to waitUntil instead of awaiting it', async () => {
    const deferred: Promise<unknown>[] = [];
    const auth = makeAuth({ apiKey: 'wraps_test', waitUntil: (p) => deferred.push(p) });

    await auth.api.signUpEmail({ body: SIGNUP });

    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(calls.some((c) => c.path === '/v1/contacts/')).toBe(true);
  });
});

describe('wraps plugin — auth email defaults', () => {
  function authWithEmail(overrides: Parameters<typeof betterAuth>[0] = {}) {
    return betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-value-at-least-32-characters-long',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      plugins: [wraps({ email: { from: 'auth@acme.com', appName: 'Acme' } })],
      ...overrides,
    });
  }

  it('fills in sendVerificationEmail when the app has none', async () => {
    const ctx = await authWithEmail().$context;
    expect(typeof ctx.options.emailVerification?.sendVerificationEmail).toBe('function');
  });

  it("does not override the app's own sendVerificationEmail", async () => {
    const own = vi.fn(async () => undefined);
    const ctx = await authWithEmail({
      emailVerification: { sendVerificationEmail: own },
    }).$context;

    expect(ctx.options.emailVerification?.sendVerificationEmail).toBe(own);
  });

  it('does not switch on password auth for an app that never enabled it', async () => {
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-value-at-least-32-characters-long',
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      plugins: [wraps({ email: { from: 'auth@acme.com' } })],
    });

    const ctx = await auth.$context;
    expect(ctx.options.emailAndPassword?.enabled).toBeFalsy();
  });

  it('leaves email options untouched when no email config is given', async () => {
    const ctx = await makeAuth().$context;
    expect(ctx.options.emailVerification?.sendVerificationEmail).toBeUndefined();
  });
});
