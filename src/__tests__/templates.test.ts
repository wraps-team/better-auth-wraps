import { describe, expect, it } from 'vitest';
import { escapeHtml, safeUrl } from '../email/render';
import {
  invitationTemplate,
  magicLinkTemplate,
  otpTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verificationTemplate,
} from '../email/templates';
import type { RenderedEmail } from '../types';

const base = { appName: 'Acme', brand: {} };
const user = { id: 'usr_1', email: 'ada@example.com', name: 'Ada Lovelace' };
const URL = 'https://acme.com/verify?token=abc123';

const all: Array<[string, RenderedEmail]> = [
  ['verification', verificationTemplate({ ...base, user, url: URL })],
  ['resetPassword', resetPasswordTemplate({ ...base, user, url: URL })],
  ['passwordChanged', passwordChangedTemplate({ ...base, user })],
  ['magicLink', magicLinkTemplate({ ...base, email: user.email, url: URL })],
  ['otp', otpTemplate({ ...base, email: user.email, otp: '482915', type: 'sign-in' })],
  [
    'invitation',
    invitationTemplate({
      ...base,
      email: user.email,
      url: URL,
      organizationName: 'Engineering',
      inviterName: 'Grace',
    }),
  ],
];

describe('every bundled template', () => {
  it.each(all)('%s renders a subject, html and text part', (_name, rendered) => {
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.html).toContain('<!doctype html>');
    expect(rendered.text.trim().length).toBeGreaterThan(0);
  });

  it.each(all)('%s mentions the app name in the subject', (_name, rendered) => {
    expect(rendered.subject).toContain('Acme');
  });

  it.each(all.filter(([name]) => name !== 'passwordChanged' && name !== 'otp'))(
    '%s puts the action URL in both the html and the text part',
    (_name, rendered) => {
      expect(rendered.html).toContain(escapeHtml(URL));
      expect(rendered.text).toContain(URL);
    }
  );

  it.each(all)('%s carries no Wraps branding', (_name, rendered) => {
    expect(rendered.html.toLowerCase()).not.toContain('wraps');
    expect(rendered.text.toLowerCase()).not.toContain('wraps');
  });
});

describe('escaping', () => {
  it('neutralises markup in a display name', () => {
    const rendered = verificationTemplate({
      ...base,
      user: { ...user, name: '<script>alert(1)</script>' },
      url: URL,
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('neutralises markup in an organisation name', () => {
    const rendered = invitationTemplate({
      ...base,
      email: user.email,
      url: URL,
      organizationName: '"><img src=x onerror=alert(1)>',
    });

    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img');
  });

  it('escapes the ampersands in a query string without breaking the link', () => {
    const rendered = magicLinkTemplate({
      ...base,
      email: user.email,
      url: 'https://acme.com/verify?token=a&callback=/dash',
    });

    expect(rendered.html).toContain('token=a&amp;callback=/dash');
    expect(rendered.text).toContain('token=a&callback=/dash');
  });
});

describe('safeUrl', () => {
  it('passes http and https through', () => {
    expect(safeUrl('https://acme.com/x')).toBe('https://acme.com/x');
    expect(safeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it('refuses any other scheme', () => {
    // A poisoned callback URL must not become an executable link in a mail client.
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeUrl('  JAVASCRIPT:alert(1)')).toBe('#');
  });

  it('drops the fallback link block when the url was rejected', () => {
    const rendered = magicLinkTemplate({
      ...base,
      email: user.email,
      url: 'javascript:alert(1)',
    });

    expect(rendered.html).not.toContain('paste this link');
  });
});

describe('branding', () => {
  it('uses the logo when one is supplied', () => {
    const rendered = verificationTemplate({
      ...base,
      brand: { logoUrl: 'https://acme.com/logo.png' },
      user,
      url: URL,
    });

    expect(rendered.html).toContain('src="https://acme.com/logo.png"');
  });

  it('applies the primary colour to the button', () => {
    const rendered = verificationTemplate({
      ...base,
      brand: { primaryColor: '#ff0055' },
      user,
      url: URL,
    });

    expect(rendered.html).toContain('bgcolor="#ff0055"');
  });

  it('adds the support address to both parts of the footer', () => {
    const rendered = verificationTemplate({
      ...base,
      brand: { supportEmail: 'help@acme.com' },
      user,
      url: URL,
    });

    expect(rendered.html).toContain('mailto:help@acme.com');
    expect(rendered.text).toContain('help@acme.com');
  });
});

describe('otpTemplate', () => {
  it('shows the code in both parts', () => {
    const rendered = otpTemplate({ ...base, email: user.email, otp: '482915', type: 'sign-in' });
    expect(rendered.html).toContain('482915');
    expect(rendered.text).toContain('482915');
  });

  it('changes the heading by otp type', () => {
    expect(
      otpTemplate({ ...base, email: user.email, otp: '1', type: 'sign-in' }).subject
    ).toContain('sign-in code');
    expect(
      otpTemplate({ ...base, email: user.email, otp: '1', type: 'forget-password' }).subject
    ).toContain('password reset code');
    expect(
      otpTemplate({ ...base, email: user.email, otp: '1', type: 'change-email' }).subject
    ).toContain('Confirm your new email address');
  });
});

describe('invitationTemplate', () => {
  it('names the inviter when one is known', () => {
    const rendered = invitationTemplate({
      ...base,
      email: user.email,
      url: URL,
      organizationName: 'Engineering',
      inviterName: 'Grace',
    });
    expect(rendered.text).toContain('Grace invited you to join Engineering');
  });

  it('falls back to a passive phrasing without an inviter', () => {
    const rendered = invitationTemplate({
      ...base,
      email: user.email,
      url: URL,
      organizationName: 'Engineering',
    });
    expect(rendered.text).toContain("You've been invited to join Engineering");
  });
});
