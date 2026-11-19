import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { registrationArgs } from '../lib/companyRegistration'
import { errorMessage } from '../lib/errorMessage'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../convex/_generated/api'
import { Button, Field, Input, Textarea } from './ui'
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
      setError(err.message || 'Could not send the join request')
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
      setError('Company name is required')
      return
    }
    const code = (formData.code || suggestCode(formData.name)).trim()
    if (!code || code.length < 2) {
      setError('Enter a short company code (at least 2 characters)')
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
      setError(errorMessage(err, 'Error registering company'))
    } finally {
      setLoading(false)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-foam px-4">
        <p className="text-sm text-muted">Checking your account…</p>
      </div>
    )
  }

  if (registration?.status === 'pending' && !success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-foam px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="font-display text-3xl text-lagoon-950 tracking-tight">
            PBA Farm
          </p>
          <div className="bg-surface border border-foam-deep rounded-2xl px-6 py-8 shadow-sm space-y-3">
            <h1 className="text-lg font-semibold text-chart-ink">
              Registration awaiting approval
            </h1>
            <p className="text-sm text-muted">
              {registration.name} ({registration.code}) was submitted for
              approval. You get access as its admin once it is approved. This
              page updates on its own.
            </p>
            {user.companyId ? (
              <Button href="/dashboard" variant="secondary" className="w-full">
                Back to the app
              </Button>
            ) : (
              <Button variant="secondary" className="w-full" onClick={handleSignOut}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const openInvites = invites || []

  return (
    <div className="min-h-screen bg-foam px-4 py-10 sm:py-14">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <Link
            href="/dashboard"
            className="font-display text-4xl text-chart-ink font-medium hover:opacity-90"
          >
            PBA Farm
          </Link>
          <h1 className="text-xl font-semibold text-chart-ink">
            {user.companyId ? 'Register another organization' : 'Register your company'}
          </h1>
          <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
            Submit farm details for approval. Once a super admin approves, you
            become its owner{user.companyId ? ' and can switch to it from your profile menu' : ''}.
            Invited by email? Open the link in the invite instead.
          </p>
        </div>

        {openInvites.length > 0 && (
          <div className="mb-6 bg-surface border border-foam-deep rounded-xl px-6 py-6 shadow-sm space-y-3">
            <h2 className="text-base font-semibold text-chart-ink">
              You have been invited
            </h2>
            <p className="text-sm text-muted">
              Ask to join, and the company&apos;s admin will approve your request.
            </p>
            <ul className="space-y-2">
              {openInvites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-foam-deep px-3 py-2"
                >
                  <div className="text-sm">
                    <p className="font-medium text-chart-ink">{invite.companyName}</p>
                    <p className="text-muted">
                      As {invite.role === 'admin' ? 'an admin' : 'a user'}
                    </p>
                  </div>
                  {invite.status === 'requested' ? (
                    <span className="text-sm text-muted">Waiting for approval</span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={joiningId === invite.id}
                      onClick={() => handleJoin(invite.id)}
                    >
                      {joiningId === invite.id ? 'Sending…' : 'Ask to join'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-surface border border-foam-deep rounded-xl px-6 py-8 shadow-sm">
          {registration?.status === 'rejected' && !success && (
            <div className="mb-5 bg-signal/10 text-signal border border-signal/20 p-3 rounded-xl text-sm">
              Your registration of {registration.name} was not approved
              {registration.rejectionReason
                ? `: ${registration.rejectionReason}`
                : '.'}{' '}
              You can submit a new one.
            </div>
          )}
          {error && (
            <div role="alert" className="mb-5 bg-signal/10 text-signal border border-signal/20 p-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-5 bg-kelp/10 text-kelp border border-kelp/25 p-3 rounded-xl text-sm space-y-1">
              <p className="font-semibold text-chart-ink">
                Registration submitted
              </p>
              <p className="text-muted">
                Awaiting super-admin approval. You’ll get access once it’s
                approved.
              </p>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <Field label="Company name" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="e.g. Hei Tech Aquaculture"
                required
                autoComplete="organization"
              />
            </Field>

            <Field
              label="Short code"
              htmlFor="code"
              required
              hint="Unique ID used across the system (letters/numbers). Auto-suggested from the name."
            >
              <Input
                id="code"
                name="code"
                value={formData.code}
                onChange={handleChange}
                placeholder={previewCode || 'e.g. HEI'}
                required
                className="font-data tabular-nums"
                maxLength={12}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Contact email" htmlFor="contactEmail" required>
                <Input
                  id="contactEmail"
                  name="contactEmail"
                  type="email"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                />
              </Field>
              <Field label="Phone" htmlFor="contactPhone" required>
                <Input
                  id="contactPhone"
                  name="contactPhone"
                  type="tel"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  placeholder="0XX XXX XXXX"
                  required
                  autoComplete="tel"
                />
              </Field>
            </div>

            <Field label="Farm / office address" htmlFor="address" required>
              <Textarea
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                rows={3}
                required
                placeholder="Street, town, region"
              />
            </Field>

            <Field
              label="Registration / tax ID"
              htmlFor="registrationNumber"
              hint="Optional business registration or tax number"
            >
              <Input
                id="registrationNumber"
                name="registrationNumber"
                value={formData.registrationNumber}
                onChange={handleChange}
                placeholder="Optional"
              />
            </Field>

            {human.widget}

            <Button
              type="submit"
              disabled={loading || !human.ready}
              className="w-full"
              size="lg"
            >
              {loading ? 'Submitting…' : 'Submit for approval'}
            </Button>
          </form>

          {companyless && !isSuperAdmin ? (
            <p className="mt-6 text-center text-sm text-muted">
              <button
                type="button"
                onClick={handleSignOut}
                className="font-medium text-lake hover:underline"
              >
                Sign out
              </button>
            </p>
          ) : (
            <p className="mt-6 text-center text-sm text-muted">
              <Link
                href="/dashboard"
                className="font-medium text-lake hover:underline"
              >
                Back to dashboard
              </Link>
              {' · '}
              <Link
                href="/company-settings"
                className="font-medium text-lake hover:underline"
              >
                Company settings
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default CompanyRegistrationsPage
