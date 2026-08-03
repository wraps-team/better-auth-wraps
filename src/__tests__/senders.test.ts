import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wrapsAuthEmails } from '../email/senders';

const send = vi.fn(async () => ({ messageId: 'msg_1' }));
const constructed: unknown[] = [];

vi.mock('@wraps.dev/email', () => ({
  WrapsEmail: class {
    send = send;
    constructor(config: unknown) {
      constructed.push(config);
    }
  },
}));

const user = { id: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' };
const URL = 'https://acme.com/verify?token=abc';

beforeEach(() => {
  constructed.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('wrapsAuthEmails', () => {
  it('sends the verification email through SES', async () => {
    const emails = wrapsAuthEmails({ from: 'Acme <auth@acme.com>', appName: 'Acme' });

    await emails.verification({ user, url: URL });

    expect(send).toHaveBeenCalledTimes(1);
    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.from).toBe('Acme <auth@acme.com>');
    expect(params.to).toBe('ada@example.com');
    expect(params.subject).toContain('Acme');
    expect(params.html).toContain('abc');
    expect(params.text).toContain(URL);
  });

  it('passes replyTo and the configuration set through', async () => {
    const emails = wrapsAuthEmails({
      from: 'auth@acme.com',
      replyTo: 'support@acme.com',
      configurationSetName: 'acme-auth',
    });

    await emails.resetPassword({ user, url: URL });

    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.replyTo).toBe('support@acme.com');
    expect(params.configurationSetName).toBe('acme-auth');
  });

  it('hands the ses config straight to the WrapsEmail constructor', async () => {
    const emails = wrapsAuthEmails({
      from: 'auth@acme.com',
      ses: { region: 'eu-west-1', roleArn: 'arn:aws:iam::123:role/Mail' },
    });

    await emails.passwordChanged({ user });

    expect(constructed).toEqual([{ region: 'eu-west-1', roleArn: 'arn:aws:iam::123:role/Mail' }]);
  });

  it('constructs the SES client once and reuses it', async () => {
    const emails = wrapsAuthEmails({ from: 'auth@acme.com' });

    await emails.verification({ user, url: URL });
    await emails.magicLink({ email: user.email, url: URL });

    expect(constructed).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports a send failure instead of throwing it into the auth flow', async () => {
    send.mockRejectedValueOnce(new Error('SES throttled'));
    const onError = vi.fn();
    const emails = wrapsAuthEmails({ from: 'auth@acme.com', onError });

    await expect(emails.verification({ user, url: URL })).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, context] = onError.mock.calls[0] as [Error, { stage: string }];
    expect(error.message).toBe('SES throttled');
    expect(context.stage).toBe('email');
  });

  it('uses a custom template when one is supplied', async () => {
    const emails = wrapsAuthEmails({
      from: 'auth@acme.com',
      templates: {
        verification: ({ url }) => ({
          subject: 'Custom subject',
          html: `<p>${url}</p>`,
          text: url,
        }),
      },
    });

    await emails.verification({ user, url: URL });

    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.subject).toBe('Custom subject');
    expect(params.html).toBe(`<p>${URL}</p>`);
  });

  it('sends the OTP email with the code', async () => {
    const emails = wrapsAuthEmails({ from: 'auth@acme.com', appName: 'Acme' });

    await emails.otp({ email: user.email, otp: '482915', type: 'sign-in' });

    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.text).toContain('482915');
  });
});

describe('wrapsAuthEmails — invitation link', () => {
  const invitation = {
    id: 'inv_1',
    email: 'newhire@example.com',
    organization: { name: 'Engineering' },
    inviter: { user: { name: 'Grace' } },
  };

  it('builds the accept URL from appUrl', async () => {
    const emails = wrapsAuthEmails({ from: 'auth@acme.com', appUrl: 'https://app.acme.com/' });

    await emails.invitation(invitation);

    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.text).toContain('https://app.acme.com/accept-invitation/inv_1');
  });

  it('prefers an explicit invitationUrl builder', async () => {
    const emails = wrapsAuthEmails({
      from: 'auth@acme.com',
      appUrl: 'https://app.acme.com',
      invitationUrl: ({ id }) => `https://acme.com/join/${id}`,
    });

    await emails.invitation(invitation);

    const params = send.mock.calls[0]?.[0] as Record<string, string>;
    expect(params.text).toContain('https://acme.com/join/inv_1');
  });

  it('refuses to send an invitation with no link rather than mailing a dead one', async () => {
    const onError = vi.fn();
    const emails = wrapsAuthEmails({ from: 'auth@acme.com', onError });

    await emails.invitation(invitation);

    expect(send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0] as [Error, unknown])[0].message).toContain('invitationUrl');
  });
});
