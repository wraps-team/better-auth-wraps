import { createPlatformClient, type PlatformClient } from '@wraps.dev/client';
import type { AuthUser, ContactSyncedPayload, WrapsPluginOptions } from '../types';
import { contactFieldsFromUser, type HookContext, resolveSignupMethod } from './resolve';

/** Turn an openapi-fetch error payload into a message safe to surface. */
function apiErrorMessage(error: unknown, status: number, fallback: string): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const message = (error as { error?: unknown }).error;
    if (typeof message === 'string' && message.length > 0) {
      return `${fallback} (${status}): ${message}`;
    }
  }
  return `${fallback} (${status})`;
}

/**
 * Which unique constraint a 409 tripped.
 *
 * The API reports the conflicting field in the message body; we need it to pick
 * the right lookup key for the follow-up PATCH. Patching by externalId when the
 * collision was on email would 404, because the existing contact was created by
 * some other integration and has no externalId yet.
 */
function conflictField(error: unknown): 'email' | 'externalId' | 'phone' | 'unknown' {
  const message =
    error && typeof error === 'object' && 'error' in error
      ? String((error as { error?: unknown }).error ?? '')
      : '';

  if (message.includes('externalId')) {
    return 'externalId';
  }
  if (message.includes('email')) {
    return 'email';
  }
  if (message.includes('phone')) {
    return 'phone';
  }
  return 'unknown';
}

/**
 * Whether a value survives a round trip through a URL path segment.
 *
 * The Platform API resolves `/v1/contacts/{id}` against raw path params — it
 * does not percent-decode them. Anything `encodeURIComponent` would escape
 * therefore has to be looked up some other way, or the request silently 404s.
 */
function isPathSafe(value: string): boolean {
  return encodeURIComponent(value) === value;
}

export interface ContactSync {
  onUserCreated: (user: AuthUser, context?: HookContext | null) => Promise<void>;
  onUserUpdated: (user: AuthUser) => Promise<void>;
  onUserDeleted: (user: AuthUser) => Promise<void>;
}

export function createContactSync(
  options: WrapsPluginOptions,
  client: PlatformClient = createPlatformClient({
    apiKey: options.apiKey as string,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  })
): ContactSync {
  const report = (error: unknown, stage: 'contact' | 'event', user: AuthUser) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)), {
      stage,
      user: { id: user.id, email: user.email },
    });
  };

  /**
   * Find an existing contact's UUID by email.
   *
   * `search` is a substring match across email and phone, so the exact address
   * still has to be picked out of the results.
   */
  async function findContactIdByEmail(email: string): Promise<string | undefined> {
    // Checked via `response.ok` rather than `error`: the list endpoint declares
    // no error responses, so openapi-fetch types `error` as `never` and
    // narrowing on it collapses the whole result to `never`.
    const result = await client.GET('/v1/contacts/', {
      params: { query: { search: email, pageSize: '100' } },
    });

    if (!result.response.ok) {
      throw new Error(
        apiErrorMessage(
          (result as { error?: unknown }).error,
          result.response.status,
          'Failed to look up Wraps contact'
        )
      );
    }

    const target = email.toLowerCase();
    return result.data?.contacts?.find((c) => c.email?.toLowerCase() === target)?.id;
  }

  /**
   * The identifier to address an existing contact with in `/v1/contacts/{id}`.
   *
   * Better Auth's default ids are URL-safe, so the externalId goes straight in.
   * A custom `generateId` that produces anything else falls back to resolving
   * the contact's UUID by email.
   */
  async function contactPathId(user: AuthUser): Promise<string | undefined> {
    if (isPathSafe(user.id)) {
      return user.id;
    }
    return user.email ? await findContactIdByEmail(user.email) : undefined;
  }

  /**
   * Create the contact, falling back to a patch when it already exists.
   *
   * A 409 here is the normal path for anyone who was already a contact before
   * they signed up — a newsletter subscriber converting, say — so it never
   * reaches `onError`.
   */
  async function upsertContact(user: AuthUser): Promise<ContactSyncedPayload | null> {
    const fields = contactFieldsFromUser(user);
    const properties = options.properties?.(user);

    const body = {
      ...fields,
      emailStatus: options.emailStatus ?? ('active' as const),
      ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
      ...(options.topicSlugs?.length ? { topicSlugs: options.topicSlugs } : {}),
    };

    const created = await client.POST('/v1/contacts/', { body });

    if (!created.error) {
      return { userId: user.id, email: user.email, contactId: created.data?.id, created: true };
    }

    if (created.response.status !== 409) {
      throw new Error(
        apiErrorMessage(created.error, created.response.status, 'Failed to create Wraps contact')
      );
    }

    const field = conflictField(created.error);
    if (field === 'phone') {
      // Another contact owns this phone number. Nothing to reconcile from a
      // signup — we never send a phone — so treat it as a no-op rather than
      // stomping on the other record.
      return null;
    }

    // Emails always contain an `@`, so they can never be used as a path param.
    // Resolve to the contact's UUID first.
    const lookupKey =
      field === 'externalId' && isPathSafe(user.id)
        ? user.id
        : await findContactIdByEmail(user.email);

    if (!lookupKey) {
      // The create said this email was taken but the search cannot find it.
      // Most likely a concurrent delete. Nothing left to reconcile.
      return null;
    }

    const patched = await client.PATCH('/v1/contacts/{id}', {
      params: { path: { id: lookupKey } },
      body,
    });

    if (patched.error) {
      throw new Error(
        apiErrorMessage(patched.error, patched.response.status, 'Failed to update Wraps contact')
      );
    }

    return { userId: user.id, email: user.email, contactId: patched.data?.id, created: false };
  }

  async function onUserCreated(user: AuthUser, context?: HookContext | null): Promise<void> {
    if (!user.email) {
      return;
    }

    if (options.shouldSync && !(await options.shouldSync(user))) {
      return;
    }

    let synced: ContactSyncedPayload | null = null;

    try {
      synced = await upsertContact(user);
      if (synced) {
        await options.onContactSynced?.(synced);
      }
    } catch (error) {
      report(error, 'contact', user);
      return;
    }

    const eventName = options.eventName ?? 'user.signed_up';
    if (eventName === false || !synced) {
      return;
    }

    try {
      const { method, provider } = resolveSignupMethod(context);
      await client.track(eventName, {
        ...(synced.contactId
          ? { contactId: synced.contactId }
          : { contactExternalId: user.id, contactEmail: user.email }),
        properties: {
          method,
          ...(provider ? { provider } : {}),
          source: 'better-auth',
        },
      });
    } catch (error) {
      report(error, 'event', user);
    }
  }

  async function onUserUpdated(user: AuthUser): Promise<void> {
    if (!user.email) {
      return;
    }

    try {
      const id = await contactPathId(user);
      if (!id) {
        return;
      }

      const fields = contactFieldsFromUser(user);
      const patched = await client.PATCH('/v1/contacts/{id}', {
        params: { path: { id } },
        body: fields,
      });

      // A user who was never synced (created before the plugin was installed,
      // or skipped by shouldSync) has no contact to patch. Not an error.
      if (patched.error && patched.response.status !== 404) {
        throw new Error(
          apiErrorMessage(patched.error, patched.response.status, 'Failed to update Wraps contact')
        );
      }
    } catch (error) {
      report(error, 'contact', user);
    }
  }

  async function onUserDeleted(user: AuthUser): Promise<void> {
    const mode = options.syncOnDelete;
    if (!mode) {
      return;
    }

    try {
      const id = await contactPathId(user);
      if (!id) {
        return;
      }

      const result =
        mode === 'delete'
          ? await client.DELETE('/v1/contacts/{id}', {
              params: { path: { id } },
            })
          : await client.PATCH('/v1/contacts/{id}', {
              params: { path: { id } },
              body: { emailStatus: 'unsubscribed' as const },
            });

      if (result.error && result.response.status !== 404) {
        throw new Error(
          apiErrorMessage(result.error, result.response.status, 'Failed to remove Wraps contact')
        );
      }
    } catch (error) {
      report(error, 'contact', user);
    }
  }

  return { onUserCreated, onUserUpdated, onUserDeleted };
}
