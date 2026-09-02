import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import DataTable from '../../components/DataTable'
import CageManageModals from '../../components/CageManageModals'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'

export default function CagesPage() {
  return (
    <ProtectedRoute>
      <Layout title="Cage Management">
        <CagesManagement />
      </Layout>
    </ProtectedRoute>
  )
}

function CagesManagement() {
  const router = useRouter()
  const { user } = useAuth()
  const cages = useQuery(api.cages.list, user ? {} : 'skip')
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
      const matchesStatus =
        statusFilter === 'all' || cage.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [cages, searchQuery, statusFilter])

  const analytics = useMemo(() => {
    if (!cages) {
      return {
        totalCages: 0,
        activeCages: 0,
        maintenanceCages: 0,
        emptyCages: 0,
      }
    }
    return {
      totalCages: cages.length,
      activeCages: cages.filter((c) => c.status === 'active').length,
      maintenanceCages: cages.filter((c) => c.status === 'maintenance').length,
      emptyCages: cages.filter((c) => c.status === 'empty').length,
    }
  }, [cages])

  const analyticsData = useMemo(() => {
    if (!cages?.length) {
      return { statusDistribution: [], harvestReadiness: [] }
    }
    const counts = {}
    cages.forEach((c) => {
      const s = c.status || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    })
    const colors = {
      active: '#10B981',
      maintenance: '#F59E0B',
      harvested: '#3B82F6',
      fallow: '#6B7280',
      empty: '#8B5CF6',
      harvesting: '#06B6D4',
      unknown: '#9CA3AF',
    }
    const statusDistribution = Object.entries(counts).map(([name, value]) => ({
      name,
      value,
      color: colors[name] || colors.unknown,
    }))
    const harvestReadiness = [
      {
        name: 'Active',
        value: cages.filter((c) => c.status === 'active').length,
        color: '#10B981',
      },
      {
        name: 'Harvesting',
        value: cages.filter((c) => c.status === 'harvesting').length,
        color: '#06B6D4',
      },
      {
        name: 'Harvested',
        value: cages.filter((c) => c.status === 'harvested').length,
        color: '#3B82F6',
      },
    ]
    return { statusDistribution, harvestReadiness }
  }, [cages])

  const columns = [
    {
      header: 'Cage Name',
      accessor: 'name',
      sortable: true,
      searchable: true,
      cell: (row) => (
        <Link
          href={`/cages/${row.id || row._id}`}
          className="text-lagoon-800 hover:text-lagoon-950 font-medium"
        >
          {row.name}
        </Link>
      ),
    },
    {
      header: 'Location',
      accessor: 'location',
      sortable: true,
      searchable: true,
      cell: (row) => row.location || '—',
    },
    {
      header: 'Size',
      accessor: 'size',
      sortable: true,
      cell: (row) => (row.size ? `${row.size} m³` : '—'),
    },
    {
      header: 'Status',
      accessor: 'status',
      sortable: true,
      filterable: true,
      cell: (row) => {
        const styles = {
          active: 'bg-green-100 text-green-800',
          maintenance: 'bg-yellow-100 text-yellow-800',
          harvested: 'bg-foam-deep text-lagoon-800',
          fallow: 'bg-foam text-gray-800',
          empty: 'bg-purple-100 text-purple-800',
          harvesting: 'bg-cyan-100 text-cyan-800',
        }
        return (
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              styles[row.status] || 'bg-foam text-gray-800'
            }`}
          >
            {row.status
              ? row.status.charAt(0).toUpperCase() + row.status.slice(1)
              : 'Unknown'}
          </span>
        )
      },
    },
    {
      header: 'Actions',
      accessor: 'id',
      sortable: false,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Edit cage"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setEditCage(row)
            }}
            className="p-1.5 rounded-lg text-lagoon-800 hover:bg-foam-deep"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Delete cage"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDeleteCage(row)
            }}
            className="p-1.5 rounded-lg text-signal hover:bg-signal/10"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="py-12 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-lagoon-800 border-t-transparent" />
        <p className="mt-2 text-muted">Loading cages…</p>
      </div>
    )
  }

  return (
    <div data-tour="page-cages">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Cages' },
        ]}
        description="Manage cages — create, edit, update status, or delete."
        related={[
          { label: 'Create cage', href: '/create-cage' },
          { label: 'Cage settings', href: '/cages/settings' },
          { label: 'Stocking', href: '/stocking' },
          { label: 'Analytics', href: '/cages/analytics' },
        ]}
        actions={
          <Button href="/create-cage" size="sm">
            <Plus className="h-4 w-4" />
            Create New Cage
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        <div className="page-card p-4">
          <div className="text-sm font-medium text-muted">Total Cages</div>
          <div className="mt-2 text-2xl font-semibold text-lagoon-800">
            {analytics.totalCages}
          </div>
        </div>
        <div className="page-card p-4">
          <div className="text-sm font-medium text-muted">Active</div>
          <div className="mt-2 text-2xl font-semibold text-green-600">
            {analytics.activeCages}
          </div>
        </div>
        <div className="page-card p-4">
          <div className="text-sm font-medium text-muted">Maintenance</div>
          <div className="mt-2 text-2xl font-semibold text-amber-600">
            {analytics.maintenanceCages}
          </div>
        </div>
        <div className="page-card p-4">
          <div className="text-sm font-medium text-muted">Empty</div>
          <div className="mt-2 text-2xl font-semibold text-purple-600">
            {analytics.emptyCages}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="page-card p-6">
          <h3 className="text-lg font-medium text-chart-ink mb-4">
            Status distribution
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={analyticsData.statusDistribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent, value }) =>
                    value > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : null
                  }
                >
                  {analyticsData.statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="page-card p-6">
          <h3 className="text-lg font-medium text-chart-ink mb-4">
            Harvest readiness
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Pie
                  data={analyticsData.harvestReadiness}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent, value }) =>
                    value > 0 ? `${name} ${(percent * 100).toFixed(0)}%` : null
                  }
                >
                  {analyticsData.harvestReadiness.map((entry, index) => (
                    <Cell key={`hr-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mb-6 page-card p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search cages by name or location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-input-border rounded-md focus:ring-lagoon-800 focus:border-lagoon-800"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-input-border rounded-md focus:ring-lagoon-800 focus:border-lagoon-800"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="harvesting">Harvesting</option>
            <option value="harvested">Harvested</option>
            <option value="fallow">Fallow</option>
            <option value="empty">Empty</option>
          </select>
        </div>
      </div>

      <div className="page-card overflow-hidden">
        <DataTable
          data={filteredCages}
          columns={columns}
          pagination={true}
          currentPage={1}
          totalPages={1}
          recordsPerPage={100}
          loading={false}
          searchable={false}
          filterable={false}
          sortable={true}
          emptyMessage="No cages found. Create your first cage to get started."
        />
      </div>

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
      />
    </div>
  )
}
