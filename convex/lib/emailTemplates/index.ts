/**
 * Anowa transactional email templates (pure TypeScript, no Convex reads).
 * See layout.ts for the shared shell and templates.ts for each email.
 *
 * Env: SITE_URL (links) and EMAIL_ASSET_BASE_URL (where public/email/* is
 * served; defaults to SITE_URL). Images are always absolute URLs.
 */
export { cleanSubject, cleanText, esc, oneLine, safeHttpUrl, safePath } from './escape'
export { appUrl, emailContext, emailEnv, emailLocale, type EmailContent, type EmailContext, type EmailLocale } from './layout'
export {
  alertEmail,
  approvalEmail,
  fmtDay,
  fmtNum,
  fmtRange,
  inviteEmail,
  passwordResetEmail,
  reportPeriodText,
  scheduledReportEmail,
  verificationCodeEmail,
  weeklySummaryEmail,
  type AlertData,
  type AlertReading,
  type ApprovalData,
  type ApprovalKind,
  type InviteData,
  type PasswordResetData,
  type ScheduledReportData,
  type VerificationCodeData,
  type WeeklyData,
} from './templates'
