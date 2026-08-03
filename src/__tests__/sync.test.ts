import type { PlatformClient } from '@wraps.dev/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContactSync } from '../sync/contact';
import type { AuthUser } from '../types';

const USER: AuthUser = { id: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' };

function ok<T>(data: T) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function fail(status: number, message: string) {
  return {
    data: undefined,
    error: { error: message },
    response: new Response(null, { status }),
  };
}

function fakeClient(
  overrides: Partial<Record<'POST' | 'PATCH' | 'DELETE' | 'track', unknown>> = {}
) {
  const client = {
    POST: vi.fn(async () => ok({ id: 'con_1' })),
    PATCH: vi.fn(async () => ok({ id: 'con_1' })),
    DELETE: vi.fn(async () => ok({ success: true })),
    track: vi.fn(async () => ({
      success: true,
      contactCreated: false,
      workflowsTriggered: 1,
      executionsResumed: 0,
    })),
    ...overrides,
  };
  return client as unknown as PlatformClient & typeof client;
}

describe('createContactSync — user created', () => {
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onError = vi.fn();
  });

  it('creates the contact then fires the signup event', async () => {
    const client = fakeClient();
    const onContactSynced = vi.fn();
    const sync = createContactSync({ apiKey: 'k', onContactSynced, onError }, client);

    await sync.onUserCreated(USER, { path: '/sign-up/email' });

    expect(client.POST).toHaveBeenCalledWith('/v1/contacts/', {
      body: {
        externalId: 'usr_1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        emailStatus: 'active',
      },
    });
    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: { method: 'email', source: 'better-auth' },
    });
    expect(onContactSynced).toHaveBeenCalledWith({
      userId: 'usr_1',
      email: 'ada@example.com',
      contactId: 'con_1',
      created: true,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('records the OAuth provider in the event properties', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k' }, client);

    await sync.onUserCreated(USER, { path: '/callback/google' });

    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: { method: 'oauth', provider: 'google', source: 'better-auth' },
    });
  });

  it('includes topics and custom properties when configured', async () => {
    const client = fakeClient();
    const sync = createContactSync(
      {
        apiKey: 'k',
        topicSlugs: ['product-updates'],
        properties: (user) => ({ plan: 'free', userId: user.id }),
      },
      client
    );

    await sync.onUserCreated(USER);

    expect(client.POST).toHaveBeenCalledWith('/v1/contacts/', {
      body: expect.objectContaining({
        properties: { plan: 'free', userId: 'usr_1' },
        topicSlugs: ['product-updates'],
      }),
    });
  });

  it('subscribes to no topics by default — a signup is not marketing consent', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k' }, client);

    await sync.onUserCreated(USER);

    const body = client.POST.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect('topicSlugs' in body).toBe(false);
  });

  it('patches instead of failing when the email already belongs to a contact', async () => {
    const client = fakeClient({
      POST: vi.fn(async () => fail(409, 'Contact with this email already exists')),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserCreated(USER);

    // Addressed by the field that actually collided. `/v1/contacts/{id}` takes
    // a UUID, an email, or an externalId.
    expect(client.PATCH).toHaveBeenCalledWith('/v1/contacts/{id}', {
      params: { path: { id: 'ada@example.com' } },
      body: expect.objectContaining({ externalId: 'usr_1' }),
    });
    // A pre-existing contact is the normal newsletter-subscriber-converts path,
    // not something worth waking anyone up for.
    expect(onError).not.toHaveBeenCalled();
  });

  it('patches by externalId when that is the conflicting field', async () => {
    const client = fakeClient({
      POST: vi.fn(async () => fail(409, 'Contact with this externalId already exists')),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserCreated(USER);

    expect(client.PATCH).toHaveBeenCalledWith('/v1/contacts/{id}', {
      params: { path: { id: 'usr_1' } },
      body: expect.anything(),
    });
  });

  it('leaves a phone-number conflict alone instead of overwriting another contact', async () => {
    const client = fakeClient({
      POST: vi.fn(async () => fail(409, 'Contact with this phone already exists')),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserCreated(USER);

    expect(client.PATCH).not.toHaveBeenCalled();
    expect(client.track).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a create failure and skips the event', async () => {
    const client = fakeClient({
      POST: vi.fn(async () => fail(500, 'Internal error')),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserCreated(USER);

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, context] = onError.mock.calls[0] as [Error, { stage: string }];
    expect(error.message).toContain('500');
    expect(error.message).toContain('Internal error');
    expect(context.stage).toBe('contact');
    expect(client.track).not.toHaveBeenCalled();
  });

  it('reports an event failure separately from the contact write', async () => {
    const client = fakeClient({
      track: vi.fn(async () => {
        throw new Error('event limit reached');
      }),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserCreated(USER);

    expect(client.POST).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [Error, { stage: string }])[1].stage).toBe('event');
  });

  it('skips the event entirely when eventName is false', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', eventName: false }, client);

    await sync.onUserCreated(USER);

    expect(client.POST).toHaveBeenCalled();
    expect(client.track).not.toHaveBeenCalled();
  });

  it('honours shouldSync', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', shouldSync: () => false }, client);

    await sync.onUserCreated(USER);

    expect(client.POST).not.toHaveBeenCalled();
  });
});

describe('createContactSync — user updated', () => {
  it('patches the contact by external id', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k' }, client);

    await sync.onUserUpdated({ ...USER, email: 'ada@newdomain.com' });

    expect(client.PATCH).toHaveBeenCalledWith('/v1/contacts/{id}', {
      params: { path: { id: 'usr_1' } },
      body: expect.objectContaining({ email: 'ada@newdomain.com' }),
    });
  });

  it('treats a missing contact as a no-op, not an error', async () => {
    const onError = vi.fn();
    const client = fakeClient({
      PATCH: vi.fn(async () => fail(404, 'Contact not found')),
    });
    const sync = createContactSync({ apiKey: 'k', onError }, client);

    await sync.onUserUpdated(USER);

    expect(onError).not.toHaveBeenCalled();
  });
});

describe('createContactSync — user deleted', () => {
  it('does nothing unless syncOnDelete is set', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k' }, client);

    await sync.onUserDeleted(USER);

    expect(client.DELETE).not.toHaveBeenCalled();
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it('unsubscribes the contact', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', syncOnDelete: 'unsubscribe' }, client);

    await sync.onUserDeleted(USER);

    expect(client.PATCH).toHaveBeenCalledWith('/v1/contacts/{id}', {
      params: { path: { id: 'usr_1' } },
      body: { emailStatus: 'unsubscribed' },
    });
  });

  it('deletes the contact', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', syncOnDelete: 'delete' }, client);

    await sync.onUserDeleted(USER);

    expect(client.DELETE).toHaveBeenCalledWith('/v1/contacts/{id}', {
      params: { path: { id: 'usr_1' } },
    });
  });
});

describe('createContactSync — attribution', () => {
  const CONTEXT = {
    path: '/sign-up/email',
    headers: new Headers({
      cookie: `wraps_attribution=${encodeURIComponent(
        JSON.stringify({ utm_source: 'reddit', utm_campaign: 'launch', plan: 'enterprise' })
      )}`,
    }),
  };

  it('is off unless asked for', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k' }, client);

    await sync.onUserCreated(USER, CONTEXT);

    const body = client.POST.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect('properties' in body).toBe(false);
    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: { method: 'email', source: 'better-auth' },
    });
  });

  it('lands on both the contact and the signup event', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', attribution: true }, client);

    await sync.onUserCreated(USER, CONTEXT);

    expect(client.POST).toHaveBeenCalledWith('/v1/contacts/', {
      body: expect.objectContaining({
        properties: { utm_source: 'reddit', utm_campaign: 'launch' },
      }),
    });
    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: {
        utm_source: 'reddit',
        utm_campaign: 'launch',
        method: 'email',
        source: 'better-auth',
      },
    });
  });

  it('can be limited to one destination', async () => {
    const client = fakeClient();
    const sync = createContactSync({ apiKey: 'k', attribution: { event: false } }, client);

    await sync.onUserCreated(USER, CONTEXT);

    expect(client.POST).toHaveBeenCalledWith('/v1/contacts/', {
      body: expect.objectContaining({
        properties: { utm_source: 'reddit', utm_campaign: 'launch' },
      }),
    });
    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: { method: 'email', source: 'better-auth' },
    });
  });

  it('loses to an explicit properties callback on key collisions', async () => {
    const client = fakeClient();
    const sync = createContactSync(
      {
        apiKey: 'k',
        attribution: true,
        properties: () => ({ utm_source: 'trusted', plan: 'free' }),
      },
      client
    );

    await sync.onUserCreated(USER, CONTEXT);

    expect(client.POST).toHaveBeenCalledWith('/v1/contacts/', {
      body: expect.objectContaining({
        properties: { utm_source: 'trusted', utm_campaign: 'launch', plan: 'free' },
      }),
    });
  });

  it('cannot shadow the resolved signup method', async () => {
    const client = fakeClient();
    const sync = createContactSync(
      { apiKey: 'k', attribution: { fields: ['method', 'source'] } },
      client
    );

    await sync.onUserCreated(USER, {
      path: '/callback/google',
      headers: new Headers({
        cookie: `wraps_attribution=${encodeURIComponent(
          JSON.stringify({ method: 'spoofed', source: 'spoofed' })
        )}`,
      }),
    });

    expect(client.track).toHaveBeenCalledWith('user.signed_up', {
      contactId: 'con_1',
      properties: { method: 'oauth', provider: 'google', source: 'better-auth' },
    });
  });

  it('reports a throwing custom parser without failing the sync', async () => {
    const client = fakeClient();
    const onError = vi.fn();
    const sync = createContactSync(
      {
        apiKey: 'k',
        onError,
        attribution: {
          parse: () => {
            throw new Error('bad parser');
          },
        },
      },
      client
    );

    await sync.onUserCreated(USER, CONTEXT);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'bad parser' }),
      expect.objectContaining({ stage: 'attribution' })
    );
    expect(client.POST).toHaveBeenCalled();
    expect(client.track).toHaveBeenCalled();
  });
});

describe('createContactSync — hook context passthrough', () => {
  it('hands the context to properties and shouldSync', async () => {
    const client = fakeClient();
    const properties = vi.fn(() => ({ plan: 'free' }));
    const shouldSync = vi.fn(() => true);
    const sync = createContactSync({ apiKey: 'k', properties, shouldSync }, client);
    const context = { path: '/sign-up/email', headers: new Headers({ 'x-tenant': 'acme' }) };

    await sync.onUserCreated(USER, context);

    expect(shouldSync).toHaveBeenCalledWith(USER, context);
    expect(properties).toHaveBeenCalledWith(USER, context);
  });
});
