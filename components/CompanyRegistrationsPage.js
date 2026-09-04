import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import companyService from '../lib/companyService'
import { useAuth } from '../contexts/AuthContext'
import { Button, Field, Input, Textarea } from './ui'

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
  const { user, loading: authLoading } = useAuth()
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
      const response = await companyService.registerCompany({
        name: formData.name.trim(),
        code,
        contactEmail: formData.contactEmail.trim(),
        contactPhone: formData.contactPhone.trim(),
        address: formData.address.trim(),
        registrationNumber: formData.registrationNumber.trim(),
      })

      if (response.error) throw response.error

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
      setError(err.message || 'Error registering company')
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

  if (user.companyId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-foam px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <p className="font-display text-3xl text-lagoon-950 tracking-tight">
            PBA Farm
          </p>
          <div className="bg-surface border border-foam-deep rounded-2xl px-6 py-8 shadow-sm space-y-3">
            <h1 className="text-lg font-semibold text-chart-ink">
              Already linked to a company
            </h1>
            <p className="text-sm text-muted">
              Your account already belongs to a company. Open company settings
              to manage details.
            </p>
            <Button href="/company-settings" className="w-full">
              Company settings
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-foam px-4 py-10 sm:py-14">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <Link
            href="/dashboard"
            className="font-display text-4xl text-lagoon-950 tracking-tight hover:opacity-90"
          >
            PBA Farm
          </Link>
          <div className="waterline mx-auto mt-3 mb-4 max-w-[8rem]" />
          <h1 className="text-xl font-semibold text-chart-ink">
            Register your company
          </h1>
          <p className="mt-1 text-sm text-muted max-w-sm mx-auto">
            Submit farm details for approval. Once a super admin approves, you
            become the company admin.
          </p>
        </div>

        <div className="bg-surface border border-foam-deep rounded-2xl px-6 py-8 shadow-sm">
          {error && (
            <div className="mb-5 bg-signal/10 text-signal border border-signal/20 p-3 rounded-xl text-sm">
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
                className="font-data uppercase tracking-wide"
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

            <Button
              type="submit"
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? 'Submitting…' : 'Submit for approval'}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            <Link
              href="/dashboard"
              className="font-medium text-lagoon-800 hover:text-lagoon-950"
            >
              Back to dashboard
            </Link>
            {' · '}
            <Link
              href="/company-settings"
              className="font-medium text-lagoon-800 hover:text-lagoon-950"
            >
              Company settings
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default CompanyRegistrationsPage
