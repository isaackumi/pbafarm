import { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import CageManagementSidebar from '../../components/CageManagementSidebar'
import { fetchCages } from '../../store/slices/cagesSlice'
import { cageService } from '../../lib/databaseService'
import {
  Settings as SettingsIcon,
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
      <Layout>
        <div className="flex h-screen bg-gray-100">
          <CageManagementSidebar />
          <div className="flex-1 overflow-auto">
            <div className="p-6">
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Cage Settings</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Manage cage configurations and maintenance settings
                </p>
              </div>

              {/* Message Display */}
              {message.text && (
                <div
                  className={`mb-4 p-4 rounded-md ${
                    message.type === 'success'
                      ? 'bg-green-50 text-green-800'
                      : 'bg-red-50 text-red-800'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cage List */}
                <div className="bg-white rounded-lg shadow">
                  <div className="p-6">
                    <h2 className="text-lg font-medium text-gray-900 mb-4">
                      Cage List
                    </h2>
                    <div className="space-y-4">
                      {cages?.map((cage) => (
                        <div
                          key={cage.id}
                          className={`p-4 rounded-lg border ${
                            selectedCage?.id === cage.id
                              ? 'border-indigo-500 bg-indigo-50'
                              : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-medium text-gray-900">
                                {cage.name}
                              </h3>
                              <p className="text-sm text-gray-500">
                                {cage.location || 'No location specified'}
                              </p>
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEditCage(cage)}
                                className="p-2 text-gray-400 hover:text-gray-500"
                              >
                                <Edit2 className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedCage(cage)
                                  setShowDeleteConfirm(true)
                                }}
                                className="p-2 text-gray-400 hover:text-red-500"
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
                  <div className="bg-white rounded-lg shadow">
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-medium text-gray-900">
                          {editMode ? 'Edit Cage' : 'Cage Details'}
                        </h2>
                        {editMode && (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setEditMode(false)}
                              className="p-2 text-gray-400 hover:text-gray-500"
                            >
                              <X className="w-5 h-5" />
                            </button>
                            <button
                              onClick={handleSaveChanges}
                              className="p-2 text-gray-400 hover:text-green-500"
                            >
                              <Save className="w-5 h-5" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Cage Name
                          </label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) =>
                              setFormData({ ...formData, name: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Location
                          </label>
                          <input
                            type="text"
                            value={formData.location}
                            onChange={(e) =>
                              setFormData({ ...formData, location: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Size (m³)
                          </label>
                          <input
                            type="number"
                            value={formData.size}
                            onChange={(e) =>
                              setFormData({ ...formData, size: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Capacity
                          </label>
                          <input
                            type="number"
                            value={formData.capacity}
                            onChange={(e) =>
                              setFormData({ ...formData, capacity: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Material
                          </label>
                          <input
                            type="text"
                            value={formData.material}
                            onChange={(e) =>
                              setFormData({ ...formData, material: e.target.value })
                            }
                            disabled={!editMode}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Notes
                          </label>
                          <textarea
                            value={formData.notes}
                            onChange={(e) =>
                              setFormData({ ...formData, notes: e.target.value })
                            }
                            disabled={!editMode}
                            rows="3"
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <div className="flex items-center mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500 mr-2" />
                <h3 className="text-lg font-medium text-gray-900">
                  Delete Cage
                </h3>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Are you sure you want to delete this cage? This action cannot be
                undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteCage}
                  className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </Layout>
    </ProtectedRoute>
  )
} 