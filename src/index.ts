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
export {
  DEFAULT_ATTRIBUTION_COOKIE,
  DEFAULT_ATTRIBUTION_FIELDS,
  resolveAttribution,
} from './sync/attribution';
export { type ContactSync, createContactSync } from './sync/contact';
export { contactFieldsFromUser, resolveSignupMethod, splitName } from './sync/resolve';
export type {
  AttributionOptions,
  AuthUser,
  ContactSyncedPayload,
  HeaderLike,
  HookContext,
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
