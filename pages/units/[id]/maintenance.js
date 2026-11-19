import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import UnitTabs from '../../../components/UnitTabs'
import InspectionForm from '../../../components/InspectionForm'
import InspectionHistory from '../../../components/InspectionHistory'
import Link from 'next/link'
import { ClipboardCheck, Plus } from 'lucide-react'
import EquipmentForm from '../../../components/EquipmentForm'
import { Button, Card, EmptyState, GradientButton, LoadingState, StatusDot, Table } from '../../../components/ui'
import { useEquipmentColumns } from '../../../components/units/equipmentColumns'
import { useT } from '../../../lib/i18n/context'
import { useToast } from '../../../components/Toast'
import { useAuth } from '../../../contexts/AuthContext'
import { api } from '../../../convex/_generated/api'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate, localToday, unitLabel } from '../../../lib/format'

const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
import { usePermission } from '../../../hooks/usePermission'

function MaintenancePage() {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const canLog = usePermission('production.daily.record')
  const isAdmin = usePermission('org.sites.manage')
  const { showToast } = useToast()
  const id = typeof router.query.id === 'string' ? router.query.id : null
  const ws = useQuery(api.units.workspace, user && id ? { id } : 'skip')
  const gear = useQuery(api.equipment.list, user && id ? { unitId: id } : 'skip')
  const history = useQuery(api.equipment.listInspections, user && id ? { unitId: id } : 'skip')
  const items = useQuery(api.inventoryItems.listItems, user ? {} : 'skip')
  const log = useMutation(api.equipment.logInspection)
  const [adding, setAdding] = useState(false)
  const columns = useEquipmentColumns({ asOf: localToday(), showUnit: false })

  if (ws === undefined || !id) {
    return <Layout title={t('equipmentUi.title')}><LoadingState /></Layout>
  }
  if (ws === null) {
    return <Layout title={t('equipmentUi.title')}><EmptyState title={t('cageDetail.notFound')} action={<Button href="/units">{t('cageDetail.back')}</Button>} /></Layout>
  }
  const unit = ws.unit
  const today = localToday()
  const spares = (Array.isArray(items) ? items : []).filter((i) => ['spare', 'net', 'equipment'].includes(i.category))

  const save = async (args) => {
    try {
      const res = await log({ ...args, unitId: id })
      showToast(res.nextDueOn ? `Saved. Next due ${res.nextDueOn}` : 'Saved', 'success')
      return true
    } catch (err) {
      showToast(errorMessage(err, 'Could not save'), 'error')
      return false
    }
  }

  const isCage = ws.unitType === 'cage'
  const head = 'flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5'
  const h2 = 'text-[17px] font-semibold leading-[22px] text-text'

  return (
    <Layout
      title={unit.name}
      eyebrow={
        <>
          <Link href="/cages" className="hover:text-text hover:underline">{unitLabel(ws.unitType, { plural: true })}</Link>
          {' · '}
          {t('equipmentUi.lastMaintained', { date: unit.lastMaintenanceDate ? formatDate(unit.lastMaintenanceDate) : t('equipmentUi.never') })}
          {unit.nextMaintenanceDate ? ` · ${t('equipmentUi.nextDue', { date: formatDate(unit.nextMaintenanceDate) })}` : ''}
        </>
      }
      actions={
        <>
          {canLog && (
            <GradientButton href="#log-job" icon={ClipboardCheck}>
              {t('equipmentUi.logInspection')}
            </GradientButton>
          )}
          {isAdmin && (
            <GradientButton reverse icon={Plus} onClick={() => setAdding(true)}>
              {t('equipmentUi.add')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <UnitTabs unitId={id} active="maintenance" unitType={ws.unitType} />

        {unit.nextMaintenanceDate && unit.nextMaintenanceDate < today && (
          <p
            role="status"
            className="flex items-center gap-3 rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] px-4 py-3 text-sm text-alert"
          >
            <StatusDot tone="alert" size={7} />
            {isCage
              ? t('equipmentUi.netOverdue', { date: formatDate(unit.nextMaintenanceDate) })
              : t('equipmentUi.maintOverdue', { date: formatDate(unit.nextMaintenanceDate) })}
          </p>
        )}

        {adding && (
          <Card>
            <h2 className={`${h2} mb-5`}>{t('equipmentUi.add')}</h2>
            <EquipmentForm unitId={id} onDone={() => setAdding(false)} />
          </Card>
        )}

        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <Table
            className="min-w-0 xl:grow-[1.6] xl:basis-0"
            title={isCage ? t('unitTabs.netsEquipment') : t('unitTabs.equipment')}
            columns={columns}
            rows={gear || []}
            empty={gear === undefined ? t('equipmentUi.loading') : t('equipmentUi.noneOnUnit')}
          />
          {canLog && (
            <section id="log-job" aria-labelledby="log-job-title" className={`${card} min-w-0 scroll-mt-24 xl:grow xl:basis-0`}>
              <div className={head}>
                <h2 id="log-job-title" className={h2}>
                  {isCage ? t('equipmentUi.logNet') : t('equipmentUi.logMaint')}
                </h2>
              </div>
              <div className="p-6">
                <InspectionForm unitType={ws.unitType} equipment={gear || []} spares={spares} onSave={save} />
              </div>
            </section>
          )}
        </div>

        <section aria-labelledby="history-title" className={card}>
          <div className={head}>
            <h2 id="history-title" className={h2}>{t('equipmentUi.history')}</h2>
          </div>
          <InspectionHistory rows={history} />
        </section>
      </div>
    </Layout>
  )
}

export default function UnitMaintenancePage() {
  return (
    <ProtectedRoute>
      <MaintenancePage />
    </ProtectedRoute>
  )
}
