/**
 * Enterprise single sign-on (ENT-003): one generic OpenID Connect provider,
 * configured on the Convex deployment. Off unless all three are set:
 *
 *   AUTH_OIDC_ISSUER   e.g. https://login.microsoftonline.com/<tenant>/v2.0
 *   AUTH_OIDC_ID       client id
 *   AUTH_OIDC_SECRET   client secret
 *   AUTH_OIDC_NAME     optional button label ("Contoso SSO")
 *
 * The IdP's redirect URI is `<CONVEX_SITE_URL>/api/auth/callback/oidc`.
 * An SSO sign-in links to an existing account only when the IdP says the
 * email is verified (`email_verified: true`). The profile never carries a
 * role, so SSO cannot change a platform role; company access still comes
 * from memberships, and two-step verification still applies.
 *
 * SAML is not built in: the only Auth.js path (BoxyHQ SAML Jackson) needs a
 * separately run SAML-to-OIDC service. Put any SAML IdP behind such a broker
 * (Jackson, Keycloak, Okta, Entra) and connect it here as OIDC.
 */
import type { OIDCConfig } from '@auth/core/providers'
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id'

export const OIDC_PROVIDER_ID = 'oidc'

type OidcProfile = {
  sub?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  preferred_username?: string
}

export function oidcConfigFromEnv(env: Record<string, string | undefined> = process.env) {
  const issuer = env.AUTH_OIDC_ISSUER?.trim()
  const clientId = env.AUTH_OIDC_ID?.trim()
  const clientSecret = env.AUTH_OIDC_SECRET?.trim()
  if (!issuer || !clientId || !clientSecret) return null
  return {
    issuer: issuer.replace(/\/+$/, ''),
    clientId,
    clientSecret,
    name: env.AUTH_OIDC_NAME?.trim() || 'Single sign-on',
  }
}

export function oidcProfile(p: OidcProfile) {
  const email = typeof p.email === 'string' ? p.email.trim().toLowerCase() : undefined
  const verified = p.email_verified === true || p.email_verified === 'true'
  return {
    id: String(p.sub ?? ''),
    ...(email ? { email } : {}),
    ...(p.name || p.preferred_username ? { name: p.name || p.preferred_username } : {}),
    emailVerified: Boolean(email && verified),
  }
}

/** `[]` when SSO is not configured, so the provider list is unchanged. */
export function oidcProviderFromEnv(env: Record<string, string | undefined> = process.env): OIDCConfig<OidcProfile>[] {
  const cfg = oidcConfigFromEnv(env)
  if (!cfg) return []
  return [
    {
      id: OIDC_PROVIDER_ID,
      name: cfg.name,
      type: 'oidc',
      issuer: cfg.issuer,
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      authorization: { params: { scope: 'openid email profile' } },
      checks: ['pkce', 'state'],
      allowDangerousEmailAccountLinking: false,
      profile: (p) => oidcProfile(p) as never,
    },
  ]
}

/**
 * Social sign-in (Paper 15 "Google" / "Microsoft"): each provider is on only
 * when its client id and secret are set on the Convex deployment.
 *
 *   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
 *   AUTH_MICROSOFT_ENTRA_ID_ID, AUTH_MICROSOFT_ENTRA_ID_SECRET
 *   AUTH_MICROSOFT_ENTRA_ID_ISSUER   optional, default the "common" tenant
 *
 * Redirect URIs: `<CONVEX_SITE_URL>/api/auth/callback/google` and
 * `…/callback/microsoft-entra-id`. Profiles go through oidcProfile, so an
 * account links to an existing one only when the email is verified, and
 * never carries a role.
 */
export const GOOGLE_PROVIDER_ID = 'google'
export const MICROSOFT_PROVIDER_ID = 'microsoft-entra-id'

export function socialAvailability(env: Record<string, string | undefined> = process.env) {
  const set = (k: string) => Boolean(env[k]?.trim())
  return {
    google: set('AUTH_GOOGLE_ID') && set('AUTH_GOOGLE_SECRET'),
    microsoft: set('AUTH_MICROSOFT_ENTRA_ID_ID') && set('AUTH_MICROSOFT_ENTRA_ID_SECRET'),
  }
}

/** The configured social providers (`[]` when none), for convexAuth. */
export function socialProvidersFromEnv(env: Record<string, string | undefined> = process.env): OIDCConfig<OidcProfile>[] {
  const on = socialAvailability(env)
  const out: OIDCConfig<OidcProfile>[] = []
  if (on.google) {
    out.push({
      id: GOOGLE_PROVIDER_ID,
      name: 'Google',
      type: 'oidc',
      issuer: 'https://accounts.google.com',
      clientId: env.AUTH_GOOGLE_ID!.trim(),
      clientSecret: env.AUTH_GOOGLE_SECRET!.trim(),
      authorization: { params: { scope: 'openid email profile' } },
      checks: ['pkce', 'state'],
      allowDangerousEmailAccountLinking: false,
      profile: (p) => oidcProfile(p) as never,
    })
  }
  if (on.microsoft) {
    // Auth.js' provider: its discovery fetch fills the "{tenantid}" issuer of
    // the multi-tenant ("common") endpoint. The profile is ours (no photo call).
    const base = MicrosoftEntraID({
      clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID!.trim(),
      clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!.trim(),
      issuer: (env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim() || 'https://login.microsoftonline.com/common/v2.0').replace(/\/+$/, ''),
    })
    out.push({
      ...base,
      name: 'Microsoft',
      authorization: { params: { scope: 'openid email profile' } },
      checks: ['pkce', 'state'],
      allowDangerousEmailAccountLinking: false,
      profile: (p: OidcProfile) => oidcProfile(p) as never,
    } as unknown as OIDCConfig<OidcProfile>)
  }
  return out
}
