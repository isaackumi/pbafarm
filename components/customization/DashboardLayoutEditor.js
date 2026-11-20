import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { RotateCcw, Save } from 'lucide-react'
import { GhostButton, GradientButton } from '../ui'
import { useToast } from '../Toast'
import { api } from '../../convex/_generated/api'
import { errorMessage } from '../../lib/errorMessage'
import { useT } from '../../lib/i18n/context'
import { usePermissions } from '../../hooks/usePermission'
import { DEFAULT_DASHBOARD } from '../../convex/lib/dashboardLayout'
import WidgetListEditor from '../dashboard/WidgetListEditor'
import { SettingsCard } from '../settings'

/**
 * Customization → Dashboard (CUSTOM-005): the organization's default home
 * dashboard. Members can still arrange their own from the dashboard.
 */
export default function DashboardLayoutEditor() {
  const t = useT()
  const { can } = usePermissions()
  const { showToast } = useToast()
  const org = useQuery(api.dashboardLayouts.getOrgDefault, { key: 'home' })
  const save = useMutation(api.dashboardLayouts.save)
  const reset = useMutation(api.dashboardLayouts.reset)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (org !== undefined && draft === null) setDraft(org?.widgets ?? DEFAULT_DASHBOARD)
  }, [org, draft])

  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', done)
    } catch (err) {
      showToast('error', errorMessage(err, t('dashboardLayout.saveFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard title={t('dashboardLayout.orgTitle')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">{t('dashboardLayout.orgIntro')}</p>
      {draft === null ? (
        <p className="border-t border-line py-3 text-[13px] leading-4 text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <WidgetListEditor widgets={draft} onChange={setDraft} can={can} />
          <div className="mt-4 flex flex-wrap gap-2">
            <GradientButton ring="sky" disabled={busy} onClick={() => run(() => save({ key: 'home', scope: 'org', widgets: draft }), t('dashboardLayout.savedOrg'))}>
              <Save className="h-4 w-4" aria-hidden />
              {t('dashboardLayout.saveOrg')}
            </GradientButton>
            <GhostButton
              disabled={busy || !org}
              onClick={() =>
                run(async () => {
                  await reset({ key: 'home', scope: 'org' })
                  setDraft(DEFAULT_DASHBOARD)
                }, t('dashboardLayout.resetDone'))
              }
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              {t('dashboardLayout.resetOrg')}
            </GhostButton>
          </div>
        </>
      )}
    </SettingsCard>
  )
}
