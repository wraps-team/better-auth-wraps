import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { organization } from 'better-auth/plugins';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wraps } from '../plugin';

const send = vi.fn(async (_params: Record<string, string>) => ({ messageId: 'msg_1' }));
const constructed: unknown[] = [];

vi.mock('@wraps.dev/email', () => ({
  WrapsEmail: class {
    send = send;
    constructor(config: unknown) {
      constructed.push(config);
    }
  },
}));

beforeEach(() => {
  send.mockClear();
  constructed.length = 0;
});

describe('wraps plugin — exposed senders', () => {
  it('has no senders without email config', () => {
    expect(wraps({ apiKey: 'wraps_test' }).emails).toBeUndefined();
  });

  it('sends organization invitations through plugin.emails, on the same SES client', async () => {
    const plugin = wraps({
      email: { from: 'auth@acme.com', appName: 'Acme', appUrl: 'https://app.acme.com/' },
    });
    const auth = betterAuth({
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-value-at-least-32-characters-long',
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        organization: [],
        member: [],
        invitation: [],
      }),
      emailAndPassword: { enabled: true },
      plugins: [plugin, organization({ sendInvitationEmail: plugin.emails.invitation })],
    });

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'ada@example.com', password: 'correct-horse-battery', name: 'Ada' },
      returnHeaders: true,
    });
    const cookie = (headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const org = await auth.api.createOrganization({
      headers: new Headers({ cookie }),
      body: { name: 'Acme Corp', slug: 'acme-corp' },
    });
    const invitation = await auth.api.createInvitation({
      headers: new Headers({ cookie }),
      body: { email: 'grace@example.com', role: 'member', organizationId: org?.id },
    });

    expect(send).toHaveBeenCalledTimes(1);
    const params = send.mock.calls[0]?.[0];
    expect(params?.to).toBe('grace@example.com');
    expect(params?.subject).toContain('Acme Corp');
    expect(params?.text).toContain(`https://app.acme.com/accept-invitation/${invitation.id}`);

    // A plugin-filled sender (verification) shares the client the invitation used.
    await auth.api.sendVerificationEmail({ body: { email: 'ada@example.com' } });
    expect(send).toHaveBeenCalledTimes(2);
    expect(constructed).toHaveLength(1);
  });
});
