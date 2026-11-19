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
