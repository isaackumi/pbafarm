/**
 * Access-refusal messages shared by the backend (requireUser and the tenancy
 * helpers) and the browser (AuthWrapper signs the user out on the first two).
 *
 * Each message starts with a stable CODE followed by ": ". The client matches
 * the code, never the wording, so the text can change freely. This file has no
 * imports so pages can load it without pulling in server code.
 *
 * Plain Error messages are redacted to "Server Error" on Convex production
 * deployments, so the client also reads the same state from users.current.
 */
export const AUTH_ERROR_CODES = {
  USER_INACTIVE: 'USER_INACTIVE',
  COMPANY_NOT_APPROVED: 'COMPANY_NOT_APPROVED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  NO_COMPANY: 'NO_COMPANY',
} as const

export type AuthErrorCode = keyof typeof AUTH_ERROR_CODES

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  USER_INACTIVE:
    'USER_INACTIVE: Your account has been deactivated. Ask your company admin to reactivate it.',
  COMPANY_NOT_APPROVED:
    'COMPANY_NOT_APPROVED: Your company does not have access to PBA Farm right now. Contact support.',
  PASSWORD_CHANGE_REQUIRED:
    'PASSWORD_CHANGE_REQUIRED: Change your temporary password before continuing.',
  NO_COMPANY:
    'NO_COMPANY: Your account is not linked to a company yet. Register a company or ask an admin to invite you.',
}

/** Codes that end the session: the client signs out and shows the message. */
export const SIGN_OUT_CODES: AuthErrorCode[] = ['USER_INACTIVE', 'COMPANY_NOT_APPROVED']

/** Find an access-refusal code inside any error (Convex wraps the message). */
export function authErrorCode(error: unknown): AuthErrorCode | null {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : ''
  for (const code of Object.keys(AUTH_ERROR_CODES) as AuthErrorCode[]) {
    if (message.includes(`${code}:`)) return code
  }
  return null
}

/** The human part of a message, without the "CODE: " prefix. */
export function authErrorText(code: AuthErrorCode): string {
  return AUTH_ERROR_MESSAGES[code].slice(code.length + 2)
}
