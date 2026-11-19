import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Archive, Pencil, Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, GhostButton, GradientButton, LoadingState, Pill } from '../../components/ui'
import FarmSetupNav from '../../components/units/FarmSetupNav'
import { useTerm } from '../../hooks/useTerm'
import { useT } from '../../lib/i18n/context'
import CageManageModals from '../../components/CageManageModals'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { usePermission } from '../../hooks/usePermission'

export default function CageSettingsPage() {
  return (
    <ProtectedRoute>
      <CageSettings />
    </ProtectedRoute>
  )
}

function CageSettings() {
  const t = useT()
  const term = useTerm()
  const { user } = useAuth()
  const isAdmin = usePermission('production.stock.adjust')
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const [editCage, setEditCage] = useState(null)
  const [deleteCage, setDeleteCage] = useState(null)

  return (
    <Layout
      title={term.text(t('cageSettings.title'))}
      eyebrow={t('cageSettings.eyebrow')}
      actions={
        <GradientButton href="/create-cage" icon={Plus}>
          {t('unitsUi.newCage')}
        </GradientButton>
      }
    >
      <div className="flex flex-col gap-8 md:flex-row">
        <FarmSetupNav />
        <section
          aria-labelledby="cage-settings-title"
          className="min-w-0 max-w-3xl grow rounded-card border border-line bg-surface shadow-[var(--shadow-card)]"
        >
          <div className="flex flex-col gap-1 border-b border-line px-6 py-5">
            <h2 id="cage-settings-title" className="text-[17px] font-semibold leading-[22px] text-text">
              {t('cageSettings.units')}
            </h2>
            <p className="text-xs text-muted">{t('cageSettings.helper')}</p>
          </div>
          {cages === undefined ? (
            <LoadingState />
          ) : cages.length === 0 ? (
            <EmptyState
              title={t('cageSettings.empty')}
              action={<GradientButton href="/create-cage" icon={Plus}>{t('unitsUi.newCage')}</GradientButton>}
            />
          ) : (
            <ul>
              {cages.map((cage) => (
                <li
                  key={cage.id || cage._id}
                  className="flex items-center justify-between gap-4 border-t border-line px-6 py-4 first:border-t-0"
                >
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <span className="truncate text-[14px] font-medium leading-[18px] text-text">{cage.name}</span>
                    <span className="truncate text-xs leading-4 text-muted">
                      {cage.location || t('cageSettings.noLocation')}
                      {cage.size != null ? ` · ${cage.size} m³` : ''}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {cage.status && (
                      <Pill tone={cage.status === 'active' ? 'green' : cage.status === 'maintenance' ? 'amber' : 'neutral'}>
                        {t.or(`unitsUi.status.${cage.status}`, cage.status)}
                      </Pill>
                    )}
                    <GhostButton size="sm" icon={Pencil} onClick={() => setEditCage(cage)}>
                      {t('cagesTable.edit')}
                    </GhostButton>
                    {isAdmin && (
                      <GhostButton size="sm" tone="danger" icon={Archive} onClick={() => setDeleteCage(cage)}>
                        {t('cagesTable.archive')}
                      </GhostButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
      />
    </Layout>
  )
}
