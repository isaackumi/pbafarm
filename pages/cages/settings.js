import { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import { fetchCages } from '../../store/slices/cagesSlice'
import { cageService } from '../../lib/databaseService'
import {
  AlertTriangle,
  Trash2,
  Edit2,
  Save,
  X,
} from 'lucide-react'

export default function CageSettingsPage() {
  const dispatch = useDispatch()
  const { cages, loading } = useSelector((state) => state.cages)
  const [selectedCage, setSelectedCage] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    size: '',
    capacity: '',
    material: '',
    notes: '',
  })
  const [message, setMessage] = useState({ type: '', text: '' })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    dispatch(fetchCages())
  }, [dispatch])

  const handleEditCage = (cage) => {
    setSelectedCage(cage)
    setFormData({
      name: cage.name || '',
      location: cage.location || '',
      size: cage.size || '',
      capacity: cage.capacity || '',
      material: cage.material || '',
      notes: cage.notes || '',
    })
    setEditMode(true)
  }

  const handleSaveChanges = async () => {
    try {
      const { error } = await cageService.updateCage(selectedCage.id, formData)
      if (error) throw error

      setMessage({ type: 'success', text: 'Cage updated successfully' })
      setEditMode(false)
      dispatch(fetchCages())
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const handleDeleteCage = async () => {
    try {
      const { error } = await cageService.deleteCage(selectedCage.id)
      if (error) throw error

      setMessage({ type: 'success', text: 'Cage deleted successfully' })
      setShowDeleteConfirm(false)
      setSelectedCage(null)
      dispatch(fetchCages())
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="Cage Settings">
        <div className="max-w-6xl">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Cages', href: '/cages' },
              { label: 'Settings' },
            ]}
            description="Edit cage details and manage maintenance settings."
            related={[
              { label: 'All cages', href: '/cages' },
              { label: 'Create cage', href: '/create-cage' },
              { label: 'Analytics', href: '/cages/analytics' },
            ]}
            actions={
              <Button href="/cages" variant="secondary" size="sm">
                Back to cages
              </Button>
            }
          />

              {/* Message Display */}
              {message.text && (
                <div
                  className={`mb-4 p-4 rounded-xl text-sm ${
                    message.type === 'success'
                      ? 'bg-kelp/10 text-kelp'
                      : 'bg-signal/10 text-signal'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cage List */}
                <div className="page-card">
                  <div className="p-6">
                    <h2 className="text-lg font-medium text-chart-ink mb-4">
                      Cage List
                    </h2>
                    <div className="space-y-4">
                      {cages?.map((cage) => (
                        <div
                          key={cage.id}
                          className={`p-4 rounded-lg border ${
                            selectedCage?.id === cage.id
                              ? 'border-lagoon-800 bg-foam-deep'
                              : 'border-foam-deep'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-medium text-chart-ink">
                                {cage.name}
                              </h3>
                              <p className="text-sm text-muted">
                                {cage.location || 'No location specified'}
                              </p>
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEditCage(cage)}
                                className="p-2 text-muted hover:text-muted"
                              >
                                <Edit2 className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedCage(cage)
                                  setShowDeleteConfirm(true)
                                }}
                                className="p-2 text-muted hover:text-red-500"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Edit Form */}
                {selectedCage && (
                  <div className="page-card">
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-medium text-chart-ink">
                          {editMode ? 'Edit Cage' : 'Cage Details'}
                        </h2>
                        {editMode && (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setEditMode(false)}
                              className="p-2 text-muted hover:text-muted"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <button
                              onClick={handleSaveChanges}
                              className="p-2 text-muted hover:text-green-500"
                            >
                              <Save className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Cage Name
                          </label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) =>
                              setFormData({ ...formData, name: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Location
                          </label>
                          <input
                            type="text"
                            value={formData.location}
                            onChange={(e) =>
                              setFormData({ ...formData, location: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Size (m³)
                          </label>
                          <input
                            type="number"
                            value={formData.size}
                            onChange={(e) =>
                              setFormData({ ...formData, size: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Capacity
                          </label>
                          <input
                            type="number"
                            value={formData.capacity}
                            onChange={(e) =>
                              setFormData({ ...formData, capacity: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Material
                          </label>
                          <input
                            type="text"
                            value={formData.material}
                            onChange={(e) =>
                              setFormData({ ...formData, material: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink">
                            Notes
                          </label>
                          <textarea
                            value={formData.notes}
                            onChange={(e) =>
                              setFormData({ ...formData, notes: e.target.value })
                            }
                            disabled={!editMode}
                            rows="3"
                            className="mt-1 block w-full rounded-md border-input-border shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 sm:text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-lg">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-signal mr-2" />
                <h3 className="text-lg font-medium text-chart-ink">
                  Delete Cage
                </h3>
              </div>
              <p className="text-sm text-muted mb-4">
                Are you sure you want to delete this cage? This action cannot be
                undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 border border-zinc-200 rounded-xl text-sm font-medium text-chart-ink hover:bg-foam"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteCage}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-signal hover:opacity-90"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </Layout>
    </ProtectedRoute>
  )
} 