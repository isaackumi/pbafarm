import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { Pencil, Archive, Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, GradientButton, LoadingState, Pill, Table } from '../../components/ui'
import CageManageModals from '../../components/CageManageModals'
import UnitViewSwitch from '../../components/units/UnitViewSwitch'
import { UnitsHeaderActions } from '../../components/units/UnitsHeader'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import { unitLabel } from '../../lib/format'
import { usePermission } from '../../hooks/usePermission'
import { useTerm } from '../../hooks/useTerm'
import { useT } from '../../lib/i18n/context'

const unitTypeOfRow = (row) => row.unitType || row.unit_type || 'cage'

const STATUS_TONE = {
  active: 'green',
  maintenance: 'amber',
  harvesting: 'cyan',
  harvested: 'neutral',
  fallow: 'neutral',
  empty: 'neutral',
}

const iconButton =
  'inline-flex h-8 w-8 items-center justify-center rounded-pill text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

export default function CagesPage() {
  return (
    <ProtectedRoute>
      <CagesTablePage />
    </ProtectedRoute>
  )
}

function CagesTablePage() {
  const t = useT()
  const term = useTerm()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const active = (cages || []).filter((c) => c.status === 'active').length
  return (
    <Layout
      title={term.text(t('unitsUi.title'))}
      eyebrow={cages ? t('cagesTable.eyebrow', { active, total: cages.length }) : undefined}
      actions={<UnitsHeaderActions />}
    >
      <CagesManagement cages={cages} />
    </Layout>
  )
}

function CagesManagement({ cages }) {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = usePermission('production.units.delete')
  const canEdit = usePermission('production.units.manage')
  const settingsData = useQuery(api.companies.getEffectiveSettings, user ? {} : 'skip')
  const targetAbw = Number(settingsData?.settings?.farmRules?.targetHarvestAbwG) || 600
  const loading = cages === undefined

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editCage, setEditCage] = useState(null)
  const [deleteCage, setDeleteCage] = useState(null)

  useEffect(() => {
    const filter = router.query.filter
    if (typeof filter === 'string' && filter.length > 0) {
      setStatusFilter(filter)
    }
  }, [router.query.filter])

  const filteredCages = useMemo(() => {
    if (!cages) return []
    return cages.filter((cage) => {
      const matchesSearch =
        searchQuery === '' ||
        cage.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cage.location &&
          cage.location.toLowerCase().includes(searchQuery.toLowerCase()))
      // Ready to harvest: active cages whose latest sampled ABW reached the company target.
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'ready_to_harvest'
          ? cage.status === 'active' && Number(cage.current_weight) >= targetAbw
          : cage.status === statusFilter)
      return matchesSearch && matchesStatus
    })
  }, [cages, searchQuery, statusFilter, targetAbw])

  const columns = [
    {
      key: 'name',
      header: t('cagesTable.name'),
      render: (row) => (
        <Link
          href={`/cages/${row.id || row._id}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded-sm font-medium text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          {row.name}
          {unitTypeOfRow(row) !== 'cage' && (
            <span className="ml-2 text-xs font-normal text-muted">{unitLabel(row)}</span>
          )}
        </Link>
      ),
    },
    {
      key: 'location',
      header: t('cagesTable.location'),
      render: (row) => <span className="text-muted">{row.location || '—'}</span>,
    },
    {
      key: 'size',
      header: t('cagesTable.size'),
      width: 120,
      align: 'right',
      render: (row) => (row.size ? `${row.size} m³` : '—'),
    },
    {
      key: 'abw',
      header: t('cagesTable.abw'),
      width: 120,
      align: 'right',
      render: (row) => (Number(row.current_weight) > 0 ? `${Math.round(row.current_weight)} g` : '—'),
    },
    {
      key: 'status',
      header: t('cagesTable.status'),
      width: 160,
      render: (row) => (
        <Pill tone={STATUS_TONE[row.status] || 'neutral'}>
          {t.or(`unitsUi.status.${row.status}`, row.status || t('cagesTable.unknown'))}
        </Pill>
      ),
    },
    ...(canEdit || isAdmin
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">{t('cagesTable.actions')}</span>,
            width: 96,
            align: 'right',
            render: (row) => (
              <div className="flex items-center justify-end gap-1">
                {canEdit && (
                  <button
                    type="button"
                    title={t('cagesTable.edit')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditCage(row)
                    }}
                    aria-label={t('cagesTable.editNamed', { name: row.name || '' })}
                    className={iconButton}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    title={t('cagesTable.archive')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteCage(row)
                    }}
                    aria-label={t('cagesTable.archiveNamed', { name: row.name || '' })}
                    className={`${iconButton} hover:text-alert`}
                  >
                    <Archive className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            ),
          },
        ]
      : []),
  ]

  if (loading) return <LoadingState label={t('cagesTable.loading')} />

  const tabs = [
    { value: 'all', label: t('cagesTable.tab.all') },
    { value: 'active', label: t('unitsUi.status.active') },
    { value: 'ready_to_harvest', label: t('cagesTable.tab.ready', { abw: targetAbw }) },
    { value: 'harvesting', label: t('unitsUi.status.harvesting') },
    { value: 'maintenance', label: t('unitsUi.status.maintenance') },
    { value: 'fallow', label: t('unitsUi.status.fallow') },
    { value: 'empty', label: t('unitsUi.status.empty') },
    { value: 'harvested', label: t('unitsUi.status.harvested') },
  ]

  // Paper 62 "Empty · /cages": no cages at all, not just none matching a filter.
  if (cages.length === 0) {
    return (
      <div data-tour="page-cages" className="flex flex-col gap-7">
        <UnitViewSwitch className="self-start" />
        <section className="flex min-h-[340px] flex-col items-center justify-center rounded-card border border-line bg-surface p-8 shadow-[var(--shadow-card)]">
          <EmptyState
            title={t('systemStates.emptyCages.title')}
            description={t('systemStates.emptyCages.body')}
            action={
              canEdit ? (
                <GradientButton href="/create-cage" ring="sky" size="cta" icon={Plus}>
                  {t('systemStates.emptyCages.action')}
                </GradientButton>
              ) : null
            }
          />
        </section>
      </div>
    )
  }

  return (
    <div data-tour="page-cages" className="flex flex-col gap-7">
      <UnitViewSwitch className="self-start" />
      <Table
        title={t('cagesTable.title', { count: filteredCages.length })}
        tabsLabel={t('cagesTable.filterStatus')}
        tabs={tabs}
        tab={statusFilter}
        onTabChange={setStatusFilter}
        search={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('cagesTable.search')}
        columns={columns}
        rows={filteredCages}
        rowKey={(row) => row.id || row._id}
        onRowClick={(row) => router.push(`/cages/${row.id || row._id}`)}
        empty={t('cagesTable.empty')}
      />

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
      />
    </div>
  )
}
