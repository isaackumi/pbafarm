import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { registrationArgs } from '../lib/companyRegistration'
import { errorMessage } from '../lib/errorMessage'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { LoadingState } from './ui'
import { GradientButton } from './ui/Buttons'
import { useT } from '../lib/i18n/context'
import { AuthAlert, AuthGhost, AuthStateCard } from './auth/AuthUi'
import OnboardingLayout, { ONBOARDING_INPUT, OnboardingField } from './onboarding/OnboardingLayout'
import { Hourglass } from 'lucide-react'
import { useHumanCheck } from './HumanCheck'

function suggestCode(name) {
  if (!name) return ''
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
  }
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
}

const CompanyRegistrationsPage = () => {
  const router = useRouter()
  const t = useT()
  const { user, loading: authLoading, signOut } = useAuth()
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    registrationNumber: '',
  })
  const [codeTouched, setCodeTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const companyless = Boolean(user && !user.companyId)
  // Members of an organization may register another one (ORG-004).
  const registration = useQuery(api.companies.myRegistration, user ? {} : 'skip')
  const invites = useQuery(api.users.myInvites, companyless ? {} : 'skip')
  const requestToJoin = useMutation(api.users.claimInvite)
  const registerCompany = useMutation(api.companies.register)
  const human = useHumanCheck('register_company')
  const [joiningId, setJoiningId] = useState(null)
  const isSuperAdmin = user?.role === 'super_admin'

  const handleJoin = async (inviteId) => {
    setError('')
    setJoiningId(inviteId)
    try {
      await requestToJoin({ inviteId })
    } catch (err) {
      setError(err.message || t('onboarding.joinFailed'))
    } finally {
      setJoiningId(null)
    }
  }

  const handleSignOut = async () => {
    const { cancelled } = (await signOut()) || {}
    if (cancelled) return
    router.replace('/login')
  }

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent('/register-company')}`)
    }
  }, [authLoading, user, router])

  useEffect(() => {
    if (!user?.email) return
    setFormData((prev) =>
      prev.contactEmail ? prev : { ...prev, contactEmail: user.email },
    )
  }, [user?.email])

  const previewCode = useMemo(
    () => formData.code || suggestCode(formData.name),
    [formData.code, formData.name],
  )

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => {
      const next = { ...prev, [name]: value }
      if (name === 'name' && !codeTouched) {
        next.code = suggestCode(value)
      }
      if (name === 'code') {
        next.code = value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
      }
      return next
    })
    if (name === 'code') setCodeTouched(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (!formData.name.trim()) {
      setError(t('onboarding.nameRequired'))
      return
    }
    const code = (formData.code || suggestCode(formData.name)).trim()
    if (!code || code.length < 2) {
      setError(t('onboarding.codeTooShort'))
      return
    }

    try {
      setLoading(true)
      const humanTicket = await human.getTicket()
      await registerCompany(
        registrationArgs({
          humanTicket,
          name: formData.name.trim(),
          code,
          contactEmail: formData.contactEmail.trim(),
          contactPhone: formData.contactPhone.trim(),
          address: formData.address.trim(),
          registrationNumber: formData.registrationNumber.trim(),
        }),
      )

      setSuccess(true)
      setFormData({
        name: '',
        code: '',
        contactEmail: user?.email || '',
        contactPhone: '',
        address: '',
        registrationNumber: '',
      })
      setCodeTouched(false)
    } catch (err) {
      console.error('Error registering company:', err)
      setError(errorMessage(err, t('onboarding.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <LoadingState label={t('onboarding.checking')} />
      </div>
    )
  }

  const awaiting = success || registration?.status === 'pending'
  const steps = [
    { id: 'account', label: t('onboarding.steps.account'), hint: user.email, state: 'done' },
    {
      id: 'company',
      label: t('onboarding.steps.company'),
      hint: awaiting && registration?.name ? `${registration.name} · ${registration.code}` : t('onboarding.steps.companyHint'),
      state: awaiting ? 'done' : 'current',
    },
    {
      id: 'approval',
      label: t('onboarding.steps.approval'),
      hint: t('onboarding.steps.approvalHint'),
      state: awaiting ? 'current' : 'upcoming',
    },
    { id: 'units', label: t('onboarding.steps.units'), hint: t('onboarding.steps.unitsHint'), state: 'upcoming' },
  ]

  const leaveAction =
    companyless && !isSuperAdmin ? (
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-pill px-1 text-sm leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        {t('common.signOut')}
      </button>
    ) : (
      <Link
        href="/dashboard"
        className="rounded-pill px-1 text-sm leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
      >
        ← {t('onboarding.backToApp')}
      </Link>
    )

  if (awaiting) {
    return (
      <OnboardingLayout
        steps={steps}
        title={t('onboarding.pendingTitle')}
        subtitle={t('onboarding.pendingSubtitle')}
      >
        <AuthStateCard
          icon={<Hourglass />}
          title={success && !registration?.name ? t('onboarding.submitted') : `${registration?.name || ''}${registration?.code ? ` · ${registration.code}` : ''}`}
          body={t('onboarding.pendingBody')}
        >
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {user.companyId ? (
              <AuthGhost href="/dashboard" className="sm:w-auto">
                {t('onboarding.backToApp')}
              </AuthGhost>
            ) : (
              <AuthGhost onClick={handleSignOut} className="sm:w-auto">
                {t('common.signOut')}
              </AuthGhost>
            )}
          </div>
        </AuthStateCard>
      </OnboardingLayout>
    )
  }

  const openInvites = invites || []

  return (
    <OnboardingLayout
      steps={steps}
      pageTitle={t('onboarding.pageTitle')}
      title={user.companyId ? t('onboarding.titleAnother') : t('onboarding.title')}
      subtitle={user.companyId ? t('onboarding.subtitleAnother') : t('onboarding.subtitle')}
      footer={
        <>
          {leaveAction}
          {!(companyless && !isSuperAdmin) && (
            <Link
              href="/company-settings"
              className="rounded-pill px-1 text-sm leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('onboarding.companySettings')}
            </Link>
          )}
          <GradientButton
            type="submit"
            form="register-company-form"
            variant="solid"
            className="ml-auto"
            disabled={loading || !human.ready}
          >
            {loading ? t('onboarding.submitting') : t('onboarding.submit')}
          </GradientButton>
        </>
      }
    >
      {openInvites.length > 0 && (
        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold leading-5 text-text">{t('onboarding.invitedTitle')}</h2>
            <p className="text-sm leading-5 text-muted">{t('onboarding.invitedBody')}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {openInvites.map((invite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-input border border-line px-4 py-3"
              >
                <div className="min-w-0 text-sm leading-[18px]">
                  <p className="truncate font-medium text-text">{invite.companyName}</p>
                  <p className="text-muted">
                    {invite.role === 'admin' ? t('onboarding.asAdmin') : t('onboarding.asUser')}
                  </p>
                </div>
                {invite.status === 'requested' ? (
                  <span className="text-sm text-muted">{t('onboarding.waiting')}</span>
                ) : (
                  <GradientButton size="sm" disabled={joiningId === invite.id} onClick={() => handleJoin(invite.id)}>
                    {joiningId === invite.id ? t('common.sending') : t('onboarding.askToJoin')}
                  </GradientButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {registration?.status === 'rejected' && (
        <AuthAlert>
          {t('onboarding.rejected', { name: registration.name })}
          {registration.rejectionReason ? ` ${registration.rejectionReason}` : ''}
        </AuthAlert>
      )}
      {error && <AuthAlert>{error}</AuthAlert>}

      <form id="register-company-form" className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_200px]">
          <OnboardingField label={t('onboarding.name')} htmlFor="name" required>
            <input
              id="name"
              name="name"
              className={ONBOARDING_INPUT}
              value={formData.name}
              onChange={handleChange}
              placeholder={t('onboarding.namePlaceholder')}
              required
              autoComplete="organization"
            />
          </OnboardingField>
          <OnboardingField label={t('onboarding.code')} htmlFor="code" required hint={t('onboarding.codeHint')}>
            <input
              id="code"
              name="code"
              className={`${ONBOARDING_INPUT} font-mono tabular-nums`}
              value={formData.code}
              onChange={handleChange}
              placeholder={previewCode || 'HEI'}
              required
              maxLength={12}
            />
          </OnboardingField>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <OnboardingField label={t('onboarding.contactEmail')} htmlFor="contactEmail" required>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              className={ONBOARDING_INPUT}
              value={formData.contactEmail}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </OnboardingField>
          <OnboardingField label={t('onboarding.phone')} htmlFor="contactPhone" required>
            <input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              className={ONBOARDING_INPUT}
              value={formData.contactPhone}
              onChange={handleChange}
              placeholder="0XX XXX XXXX"
              required
              autoComplete="tel"
            />
          </OnboardingField>
        </div>

        <OnboardingField label={t('onboarding.address')} htmlFor="address" required>
          <textarea
            id="address"
            name="address"
            className={`${ONBOARDING_INPUT} resize-y`}
            value={formData.address}
            onChange={handleChange}
            rows={3}
            required
            placeholder={t('onboarding.addressPlaceholder')}
          />
        </OnboardingField>

        <OnboardingField
          label={t('onboarding.registrationNumber')}
          htmlFor="registrationNumber"
          hint={t('onboarding.registrationNumberHint')}
        >
          <input
            id="registrationNumber"
            name="registrationNumber"
            className={ONBOARDING_INPUT}
            value={formData.registrationNumber}
            onChange={handleChange}
            placeholder={t('onboarding.optional')}
          />
        </OnboardingField>

        {human.widget}
        <p className="text-sm leading-5 text-muted">{t('onboarding.inviteHint')}</p>
      </form>
    </OnboardingLayout>
  )
}

export default CompanyRegistrationsPage
