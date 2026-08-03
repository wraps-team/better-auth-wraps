export { escapeHtml, renderLayout, safeUrl } from './email/render';
export { type InvitationData, type WrapsAuthEmails, wrapsAuthEmails } from './email/senders';
export {
  invitationTemplate,
  magicLinkTemplate,
  otpTemplate,
  passwordChangedTemplate,
  resetPasswordTemplate,
  verificationTemplate,
} from './email/templates';
export { type WrapsPlugin, wraps } from './plugin';
export { type ContactSync, createContactSync } from './sync/contact';
export { contactFieldsFromUser, resolveSignupMethod, splitName } from './sync/resolve';
export type {
  AuthUser,
  ContactSyncedPayload,
  InvitationTemplateInput,
  MagicLinkTemplateInput,
  OtpTemplateInput,
  OtpType,
  PasswordChangedTemplateInput,
  RenderedEmail,
  ResetPasswordTemplateInput,
  SignupMethod,
  TemplateContext,
  VerificationTemplateInput,
  WrapsAuthEmailBrand,
  WrapsAuthEmailOptions,
  WrapsAuthEmailTemplates,
  WrapsErrorContext,
  WrapsErrorStage,
  WrapsPluginOptions,
} from './types';
