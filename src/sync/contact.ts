import { createPlatformClient, type PlatformClient } from '@wraps.dev/client';
import type {
  AttributionOptions,
  AuthUser,
  ContactSyncedPayload,
  HookContext,
  WrapsPluginOptions,
} from '../types';
import { resolveAttribution } from './attribution';
import { contactFieldsFromUser, resolveSignupMethod } from './resolve';

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
  const report = (error: unknown, stage: 'contact' | 'event' | 'attribution', user: AuthUser) => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)), {
      stage,
      user: { id: user.id, email: user.email },
    });
  };

  const attributionOptions: AttributionOptions | null =
    options.attribution === true ? {} : options.attribution || null;

  /**
   * Read attribution off the signup request.
   *
   * Swallows failures — only a custom `parse` can throw, and a broken parser
   * should cost the attribution, not the signup.
   */
  function readAttribution(
    user: AuthUser,
    context?: HookContext | null
  ): Record<string, string> | null {
    if (!attributionOptions) {
      return null;
    }

    try {
      return resolveAttribution(context, attributionOptions);
    } catch (error) {
      report(error, 'attribution', user);
      return null;
    }
  }

  /**
   * Create the contact, falling back to a patch when it already exists.
   *
   * A 409 here is the normal path for anyone who was already a contact before
   * they signed up — a newsletter subscriber converting, say — so it never
   * reaches `onError`.
   */
  async function upsertContact(
    user: AuthUser,
    context?: HookContext | null,
    attribution?: Record<string, string> | null
  ): Promise<ContactSyncedPayload | null> {
    const fields = contactFieldsFromUser(user);

    // `properties` last: an explicit callback beats whatever the browser sent.
    const properties = {
      ...(attribution ?? {}),
      ...options.properties?.(user, context),
    };

    const body = {
      ...fields,
      emailStatus: options.emailStatus ?? ('active' as const),
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
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

    // `/v1/contacts/{id}` resolves a UUID, an email, or an externalId. Address
    // the contact by whichever field actually collided — patching by externalId
    // when the collision was on email would 404, because that contact came from
    // somewhere else and has no externalId yet.
    const patched = await client.PATCH('/v1/contacts/{id}', {
      params: { path: { id: field === 'externalId' ? user.id : user.email } },
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

    if (options.shouldSync && !(await options.shouldSync(user, context))) {
      return;
    }

    const attribution = readAttribution(user, context);
    let synced: ContactSyncedPayload | null = null;

    try {
      synced = await upsertContact(
        user,
        context,
        attributionOptions?.contact === false ? null : attribution
      );
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
          // Attribution first: the resolved signup method is ours to report
          // and a stray `method` key in a cookie must not shadow it.
          ...(attributionOptions?.event === false ? {} : (attribution ?? {})),
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
      const fields = contactFieldsFromUser(user);
      const patched = await client.PATCH('/v1/contacts/{id}', {
        params: { path: { id: user.id } },
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
      const result =
        mode === 'delete'
          ? await client.DELETE('/v1/contacts/{id}', {
              params: { path: { id: user.id } },
            })
          : await client.PATCH('/v1/contacts/{id}', {
              params: { path: { id: user.id } },
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
