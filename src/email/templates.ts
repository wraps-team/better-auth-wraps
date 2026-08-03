import type {
  InvitationTemplateInput,
  MagicLinkTemplateInput,
  OtpTemplateInput,
  PasswordChangedTemplateInput,
  RenderedEmail,
  ResetPasswordTemplateInput,
  VerificationTemplateInput,
} from '../types';
import { renderLayout } from './render';

/** First name if we have one, otherwise a greeting that works without one. */
function greeting(name?: string | null): string {
  const first = name?.trim().split(' ')[0];
  return first ? `Hi ${first},` : 'Hi,';
}

export function verificationTemplate(input: VerificationTemplateInput): RenderedEmail {
  const { appName, brand, user, url } = input;
  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `Confirm your email address for ${appName}`,
    heading: 'Confirm your email address',
    paragraphs: [
      greeting(user.name),
      `Confirm this address to finish setting up your ${appName} account.`,
    ],
    action: { label: 'Confirm email address', url },
    footnote: "If you didn't create this account, you can ignore this email.",
  });

  return { subject: `Confirm your email address for ${appName}`, html, text };
}

export function resetPasswordTemplate(input: ResetPasswordTemplateInput): RenderedEmail {
  const { appName, brand, user, url } = input;
  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `Reset your ${appName} password`,
    heading: 'Reset your password',
    paragraphs: [greeting(user.name), `Use the link below to choose a new ${appName} password.`],
    action: { label: 'Reset password', url },
    footnote:
      "If you didn't ask to reset your password, ignore this email — your current password still works.",
  });

  return { subject: `Reset your ${appName} password`, html, text };
}

export function passwordChangedTemplate(input: PasswordChangedTemplateInput): RenderedEmail {
  const { appName, brand, user } = input;
  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `Your ${appName} password was changed`,
    heading: 'Your password was changed',
    paragraphs: [
      greeting(user.name),
      `The password on your ${appName} account was just changed.`,
      "If that was you, there's nothing to do. If it wasn't, reset your password now and review your active sessions.",
    ],
  });

  return { subject: `Your ${appName} password was changed`, html, text };
}

export function magicLinkTemplate(input: MagicLinkTemplateInput): RenderedEmail {
  const { appName, brand, url } = input;
  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `Your sign-in link for ${appName}`,
    heading: `Sign in to ${appName}`,
    paragraphs: ['Click the button below to sign in. The link works once and then expires.'],
    action: { label: 'Sign in', url },
    footnote: "If you didn't request this link, you can safely ignore this email.",
  });

  return { subject: `Your sign-in link for ${appName}`, html, text };
}

const OTP_HEADINGS: Record<OtpTemplateInput['type'], string> = {
  'sign-in': 'Your sign-in code',
  'email-verification': 'Your verification code',
  'forget-password': 'Your password reset code',
  'change-email': 'Confirm your new email address',
};

export function otpTemplate(input: OtpTemplateInput): RenderedEmail {
  const { appName, brand, otp, type } = input;
  const heading = OTP_HEADINGS[type] ?? 'Your verification code';
  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `${heading} for ${appName}`,
    heading,
    paragraphs: [`Enter this code in ${appName} to continue.`],
    code: otp,
    footnote: "This code expires shortly. Don't share it with anyone.",
  });

  return { subject: `${heading} for ${appName}`, html, text };
}

export function invitationTemplate(input: InvitationTemplateInput): RenderedEmail {
  const { appName, brand, url, organizationName, inviterName } = input;
  const invitedBy = inviterName
    ? `${inviterName} invited you to join ${organizationName} on ${appName}.`
    : `You've been invited to join ${organizationName} on ${appName}.`;

  const { html, text } = renderLayout({
    appName,
    brand,
    previewText: `Join ${organizationName} on ${appName}`,
    heading: `Join ${organizationName}`,
    paragraphs: [invitedBy, 'Accept the invitation to get access.'],
    action: { label: 'Accept invitation', url },
    footnote: "If you weren't expecting this, you can ignore this email.",
  });

  return { subject: `Join ${organizationName} on ${appName}`, html, text };
}
