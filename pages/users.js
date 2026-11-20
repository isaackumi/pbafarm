import { useRouter } from 'next/router'
import { UserRound } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import UserManagement from '../components/UserManagement'
import MembersPanel, { MemberDetail } from '../components/MembersPanel'
import RolesPanel from '../components/RolesPanel'
import { GradientButton } from '../components/ui'
import { SettingsFrame, useSettingsEyebrow } from '../components/settings'
import { useT } from '../lib/i18n/context'

/**
 * Settings · Members (Paper 14 Team 38C-0), one member (23 Member access
 * 5OB-0, `?member=<userId>`) and Roles & permissions (22, `?view=roles`).
 */
export default function UsersPage() {
  const router = useRouter()
  const t = useT()
  const eyebrow = useSettingsEyebrow()
  const view = router.query.view === 'roles' ? 'roles' : 'members'
  const memberId = typeof router.query.member === 'string' ? router.query.member : null

  if (memberId) {
    return (
      <ProtectedRoute permission="org.members.manage">
        <MemberDetail
          userId={memberId}
          renderShell={({ name, actions, children }) => (
            <Layout
              title={name || t('settingsUi.nav.members')}
              eyebrow={[eyebrow, t('settingsUi.nav.members'), name].filter(Boolean).join(' · ')}
              actions={actions}
            >
              <SettingsFrame active="members">{children}</SettingsFrame>
            </Layout>
          )}
        />
      </ProtectedRoute>
    )
  }

  if (view === 'roles') {
    return (
      <ProtectedRoute permission="org.members.manage">
        <RolesPanel
          renderShell={({ meta, actions, children }) => (
            <Layout
              title={t('settingsUi.nav.roles')}
              eyebrow={[eyebrow, meta].filter(Boolean).join(' · ')}
              actions={actions}
            >
              <SettingsFrame active="roles">{children}</SettingsFrame>
            </Layout>
          )}
        />
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute permission="org.members.manage">
      <Layout
        title={t('settingsUi.nav.label')}
        eyebrow={eyebrow}
        actions={
          <GradientButton variant="lime" icon={UserRound} href="#invite">
            {t('settingsUi.team.invite')}
          </GradientButton>
        }
      >
        <SettingsFrame active="members">
          <MembersPanel />
          <UserManagement />
        </SettingsFrame>
      </Layout>
    </ProtectedRoute>
  )
}
