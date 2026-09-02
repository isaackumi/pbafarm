import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import {
  PageHeader,
  FormPage,
  FormCard,
  FormSection,
  FormActions,
  Field,
  Input,
  Button,
} from '../components/ui'

export default function AccountPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const changePassword = useAction(api.userAccounts.changePassword)
  const forced = router.query.force === '1' || user?.mustChangePassword

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Wait until Convex clears mustChangePassword before leaving forced flow.
  useEffect(() => {
    if (!done || user?.mustChangePassword) return
    if (router.query.force === '1') {
      router.replace('/dashboard')
    }
  }, [done, user?.mustChangePassword, router])

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setSaving(true)
    try {
      await changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setDone(true)
      showToast('success', 'Password updated')
    } catch (err) {
      const message =
        err?.message?.includes('InvalidSecret') ||
        err?.message?.includes('incorrect')
          ? 'Current password is incorrect'
          : err.message || 'Failed to change password'
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="Account">
        <FormPage width="md">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Account' },
            ]}
            description={
              forced && !done
                ? 'You must set a new password before continuing.'
                : 'Manage your login credentials.'
            }
          />

          {forced && !done && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              An admin created your account with a temporary password. Choose a
              new password to continue using the app.
            </div>
          )}

          <FormCard title="Change password" subtitle={user?.email || ''}>
            <form onSubmit={handleChangePassword} className="space-y-6">
              <FormSection>
                <div className="grid grid-cols-1 gap-5">
                  <Field label="Current password" htmlFor="currentPassword" required>
                    <Input
                      id="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="New password"
                    htmlFor="newPassword"
                    required
                    hint="At least 6 characters"
                  >
                    <Input
                      id="newPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </Field>
                  <Field label="Confirm new password" htmlFor="confirmPassword" required>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </Field>
                </div>
              </FormSection>

              {error && (
                <div className="rounded-xl bg-signal/10 text-signal px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <FormActions>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : 'Update password'}
                </Button>
              </FormActions>
            </form>
          </FormCard>
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}
