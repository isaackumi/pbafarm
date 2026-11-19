import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useAction } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import NotificationPreferencesCard from '../components/NotificationPreferencesCard'
import AccountDeletionCard from '../components/AccountDeletionCard'
import ChatChannelsCard from '../components/ChatChannelsCard'
import { AuthenticatorCard } from '../components/AuthenticatorApp'
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
                : 'Manage your login credentials and notifications.'
            }
          />

          {forced && !done && (
            <div className="mb-5 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
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

          {!(forced && !done) && (
            <div className="mt-6">
              {user?.hasPhone && !user?.phoneVerificationTime && !user?.actingAs && (
                <div className="mb-6">
                  <ConfirmPhoneCard maskedPhone={user.maskedPhone} />
                </div>
              )}
              <AuthenticatorCard />
              <div className="mt-6">
                <NotificationPreferencesCard />
              </div>
              {!user?.actingAs && (user?.realRole ?? user?.role) !== 'super_admin' && (
                <div className="mt-6">
                  <ChatChannelsCard />
                </div>
              )}
              {(user?.realRole ?? user?.role) !== 'super_admin' && (
                <div className="mt-6">
                  <AccountDeletionCard />
                </div>
              )}
            </div>
          )}
        </FormPage>
      </Layout>
    </ProtectedRoute>
  )
}

/**
 * A number an admin entered is not used for phone sign-in until its owner
 * confirms it with a code (ORG-002).
 */
function ConfirmPhoneCard({ maskedPhone }) {
  const { showToast } = useToast()
  const start = useAction(api.mfa.startPhoneConfirmation)
  const confirm = useAction(api.mfa.confirmPhone)
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await start({ channel: 'sms' })
      if (res.ok) setSentTo(res.sentTo)
      else setError(res.error || 'Could not send the code')
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not send the code')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await confirm({ code })
      if (res.ok) showToast('success', 'Phone number confirmed')
      else setError(res.error || 'That code is not right.')
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not confirm the number')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormCard
      title="Confirm your phone number"
      subtitle={`${maskedPhone || ''} was added by an admin. Confirm it to sign in with your phone.`}
    >
      <form onSubmit={submit} className="space-y-4">
        {sentTo && (
          <Field label={`Code sent to ${sentTo}`} htmlFor="phoneConfirmCode" required>
            <Input
              id="phoneConfirmCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        {error && (
          <div className="rounded-xl bg-signal/10 text-signal px-4 py-3 text-sm">{error}</div>
        )}
        <FormActions>
          <Button type="button" variant={sentTo ? 'secondary' : undefined} disabled={busy} onClick={send}>
            {sentTo ? 'Send again' : 'Send code by SMS'}
          </Button>
          {sentTo && (
            <Button type="submit" disabled={busy || !code.trim()}>
              Confirm
            </Button>
          )}
        </FormActions>
      </form>
    </FormCard>
  )
}
