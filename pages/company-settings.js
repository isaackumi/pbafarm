// pages/company-settings.js
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  Save,
  Upload,
  Trash,
  Building,
  User,
  Mail,
  Phone,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useAuth } from '../contexts/AuthContext'
import companyService from '../lib/companyService'
import { useToast } from '../components/Toast'

export default function CompanySettingsPage() {
  return (
    <ProtectedRoute requiredRole="admin">
      <CompanySettings />
    </ProtectedRoute>
  )
}

function CompanySettings() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const fileInputRef = useRef(null)

  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    abbreviation: '',
    address: '',
    contact_email: '',
    contact_phone: '',
    ai_assistant_enabled: false,
  })
  const canManageAi =
    user?.role === 'admin' ||
    user?.role === 'super_admin' ||
    user?.user_metadata?.role === 'admin' ||
    user?.user_metadata?.role === 'super_admin'

  // Fetch company data on mount
  useEffect(() => {
    fetchCompanyData()
  }, [])

  const fetchCompanyData = async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error } = await companyService.getCompanyDetails()

      if (error) throw error
      if (!data) {
        setCompany(null)
        setError(
          'No company is linked to your account yet. Register a company or ask an admin to assign you.',
        )
        return
      }

      setCompany(data)
      setFormData({
        name: data.name || '',
        abbreviation: data.abbreviation || '',
        address: data.address || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
        ai_assistant_enabled: data.settings?.ai_assistant_enabled === true,
      })
    } catch (error) {
      console.error('Error fetching company data:', error.message)
      setCompany(null)
      setError('Failed to load company data. Please try again.')
      showToast('error', 'Failed to load company data')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      // Validate form
      if (!formData.name) {
        throw new Error('Company name is required')
      }

      if (!company?.id && !company?._id) {
        throw new Error('No company loaded')
      }

      const { data, error } = await companyService.updateCompany(
        company.id || company._id,
        {
          name: formData.name,
          address: formData.address,
          contact_email: formData.contact_email,
          ai_assistant_enabled: formData.ai_assistant_enabled,
        },
      )

      if (error) throw error

      showToast('success', 'Company settings updated successfully')
      setCompany(data)
    } catch (error) {
      console.error('Error updating company:', error.message)
      setError(error.message)
      showToast('error', error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleLogoClick = () => {
    // Trigger file input click
    fileInputRef.current.click()
  }

  const handleLogoChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']
    if (!validTypes.includes(file.type)) {
      setError('Please select a valid image file (JPEG, PNG, GIF, SVG)')
      showToast('error', 'Invalid file type')
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('Image size should be less than 2MB')
      showToast('error', 'File too large')
      return
    }

    setUploading(true)
    setError('')

    try {
      const { data, error } = await companyService.uploadLogo(company.id, file)

      if (error) throw error

      showToast('success', 'Logo uploaded successfully')
      setCompany(data)
    } catch (error) {
      console.error('Error uploading logo:', error.message)
      setError('Failed to upload logo: ' + error.message)
      showToast('error', 'Failed to upload logo')
    } finally {
      setUploading(false)
      // Reset file input
      e.target.value = null
    }
  }

  const handleDeleteLogo = async () => {
    if (!company.logo_url) return

    if (!confirm('Are you sure you want to delete the company logo?')) {
      return
    }

    setUploading(true)
    setError('')

    try {
      const { data, error } = await companyService.deleteLogo(
        company.id,
        company.logo_url,
      )

      if (error) throw error

      showToast('success', 'Logo removed successfully')
      setCompany(data)
    } catch (error) {
      console.error('Error deleting logo:', error.message)
      setError('Failed to delete logo: ' + error.message)
      showToast('error', 'Failed to delete logo')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-foam font-sans">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-6">
          <Link
            href="/dashboard"
            className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-chart-ink">Company Settings</h1>
        </div>

        {/* Main Content */}
        <div className="page-card overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800"></div>
            </div>
          ) : !company ? (
            <div className="p-8">
              <div className="bg-amber-50 text-amber-900 p-4 rounded-md text-sm">
                {error ||
                  'No company is linked to your account yet. Register a company or ask an admin to assign you.'}
              </div>
              <div className="mt-4 flex gap-3">
                <Link
                  href="/register-company"
                  className="text-sm text-lagoon-800 hover:text-lagoon-950"
                >
                  Register a company
                </Link>
                <button
                  type="button"
                  onClick={fetchCompanyData}
                  className="text-sm text-muted hover:text-chart-ink"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {error && (
                <div className="mb-6 bg-red-50 text-red-800 p-4 rounded-md">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                {/* Logo Section */}
                <div className="md:col-span-1 flex flex-col items-center">
                  <div className="text-sm font-medium text-chart-ink mb-2">
                    Company Logo
                  </div>

                  <div
                    className="w-40 h-40 border-2 border-dashed border-input-border rounded-lg flex items-center justify-center cursor-pointer overflow-hidden relative"
                    onClick={handleLogoClick}
                  >
                    {uploading ? (
                      <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lagoon-800"></div>
                      </div>
                    ) : company.logo_url ? (
                      <div className="h-full w-full relative">
                        <Image
                          src={company.logo_url}
                          alt={company.name || 'Company logo'}
                          layout="fill"
                          objectFit="contain"
                        />
                      </div>
                    ) : (
                      <div className="text-center p-4">
                        <Upload className="h-10 w-10 text-muted mx-auto" />
                        <p className="text-sm text-muted mt-2">
                          Click to upload logo
                        </p>
                        <p className="text-xs text-muted mt-1">
                          JPEG, PNG, GIF, SVG (max 2MB)
                        </p>
                      </div>
                    )}

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleLogoChange}
                      accept="image/jpeg,image/png,image/gif,image/svg+xml"
                      className="hidden"
                    />
                  </div>

                  {company.logo_url && (
                    <button
                      type="button"
                      onClick={handleDeleteLogo}
                      className="mt-2 text-sm text-red-600 hover:text-red-800 inline-flex items-center"
                      disabled={uploading}
                    >
                      <Trash className="h-4 w-4 mr-1" />
                      Remove logo
                    </button>
                  )}
                </div>

                {/* Company Details Form */}
                <div className="md:col-span-2">
                  <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-chart-ink mb-1">
                          Company Name <span className="text-red-500">*</span>
                        </label>
                        <div className="relative rounded-md shadow-sm">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Building className="h-5 w-5 text-muted" />
                          </div>
                          <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="focus:ring-lagoon-800 focus:border-lagoon-800 block w-full pl-10 pr-3 py-2 sm:text-sm border-input-border rounded-md"
                            placeholder="Company Name"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-chart-ink mb-1">
                          Abbreviation
                        </label>
                        <div className="relative rounded-md shadow-sm">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <User className="h-5 w-5 text-muted" />
                          </div>
                          <input
                            type="text"
                            name="abbreviation"
                            value={formData.abbreviation}
                            onChange={handleChange}
                            className="focus:ring-lagoon-800 focus:border-lagoon-800 block w-full pl-10 pr-3 py-2 sm:text-sm border-input-border rounded-md"
                            placeholder="Company Abbreviation"
                            maxLength={5}
                          />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          Short code for the company (1-5 characters). Used for
                          feed types, etc.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-chart-ink mb-1">
                          Address
                        </label>
                        <textarea
                          name="address"
                          value={formData.address}
                          onChange={handleChange}
                          rows="3"
                          className="focus:ring-lagoon-800 focus:border-lagoon-800 block w-full py-2 px-3 sm:text-sm border-input-border rounded-md"
                          placeholder="Company Address"
                        ></textarea>
                      </div>

                      {canManageAi && (
                        <div className="rounded-md border border-lagoon-800/20 bg-foam p-4">
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              name="ai_assistant_enabled"
                              checked={!!formData.ai_assistant_enabled}
                              onChange={handleChange}
                              className="mt-1 h-4 w-4 text-lagoon-800 border-input-border rounded"
                            />
                            <span>
                              <span className="block text-sm font-medium text-chart-ink">
                                Enable AI assistant
                              </span>
                              <span className="block text-xs text-muted mt-1">
                                Only admins can change this. When off, the AI
                                widget is hidden for everyone in the company.
                              </span>
                            </span>
                          </label>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-chart-ink mb-1">
                            Contact Email
                          </label>
                          <div className="relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Mail className="h-5 w-5 text-muted" />
                            </div>
                            <input
                              type="email"
                              name="contact_email"
                              value={formData.contact_email}
                              onChange={handleChange}
                              className="focus:ring-lagoon-800 focus:border-lagoon-800 block w-full pl-10 pr-3 py-2 sm:text-sm border-input-border rounded-md"
                              placeholder="Contact Email"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-chart-ink mb-1">
                            Contact Phone
                          </label>
                          <div className="relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Phone className="h-5 w-5 text-muted" />
                            </div>
                            <input
                              type="text"
                              name="contact_phone"
                              value={formData.contact_phone}
                              onChange={handleChange}
                              className="focus:ring-lagoon-800 focus:border-lagoon-800 block w-full pl-10 pr-3 py-2 sm:text-sm border-input-border rounded-md"
                              placeholder="Contact Phone"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <button
                        type="submit"
                        disabled={saving}
                        className={`w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                          saving
                            ? 'bg-lagoon-700'
                            : 'bg-lagoon-800 hover:bg-lagoon-950'
                        } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800`}
                      >
                        {saving ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save Settings
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
