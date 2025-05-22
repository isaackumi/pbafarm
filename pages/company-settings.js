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
    <ProtectedRoute>
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
  })

  // Fetch company data on mount
  useEffect(() => {
    fetchCompanyData()
  }, [])

  const fetchCompanyData = async () => {
    setLoading(true)
    try {
      const { data, error } = await companyService.getCompanyDetails()

      if (error) throw error

      console.log('Fetched company data:', data)
      setCompany(data)
      setFormData({
        name: data.name || '',
        abbreviation: data.abbreviation || '',
        address: data.address || '',
        contact_email: data.contact_email || '',
        contact_phone: data.contact_phone || '',
      })
    } catch (error) {
      console.error('Error fetching company data:', error.message)
      setError('Failed to load company data. Please try again.')
      showToast('error', 'Failed to load company data')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
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

      // Update company
      const { data, error } = await companyService.updateCompany(company.id, {
        ...formData,
        logo_url: company.logo_url, // Preserve existing logo URL
        settings: company.settings, // Preserve existing settings
      })

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
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center mb-6">
          <Link
            href="/dashboard"
            className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Company Settings</h1>
        </div>

        {/* Main Content */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
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
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    Company Logo
                  </div>

                  <div
                    className="w-40 h-40 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer overflow-hidden relative"
                    onClick={handleLogoClick}
                  >
                    {uploading ? (
                      <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                    ) : company.logo_url ? (
                      <div className="h-full w-full relative">
                        <Image
                          src={company.logo_url}
                          alt={company.name}
                          layout="fill"
                          objectFit="contain"
                        />
                      </div>
                    ) : (
                      <div className="text-center p-4">
                        <Upload className="h-10 w-10 text-gray-400 mx-auto" />
                        <p className="text-sm text-gray-500 mt-2">
                          Click to upload logo
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Company Name <span className="text-red-500">*</span>
                        </label>
                        <div className="relative rounded-md shadow-sm">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Building className="h-5 w-5 text-gray-400" />
                          </div>
                          <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 pr-3 py-2 sm:text-sm border-gray-300 rounded-md"
                            placeholder="Company Name"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Abbreviation
                        </label>
                        <div className="relative rounded-md shadow-sm">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <User className="h-5 w-5 text-gray-400" />
                          </div>
                          <input
                            type="text"
                            name="abbreviation"
                            value={formData.abbreviation}
                            onChange={handleChange}
                            className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 pr-3 py-2 sm:text-sm border-gray-300 rounded-md"
                            placeholder="Company Abbreviation"
                            maxLength={5}
                          />
                        </div>
                        <p className="mt-1 text-xs text-gray-500">
                          Short code for the company (1-5 characters). Used for
                          feed types, etc.
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Address
                        </label>
                        <textarea
                          name="address"
                          value={formData.address}
                          onChange={handleChange}
                          rows="3"
                          className="focus:ring-indigo-500 focus:border-indigo-500 block w-full py-2 px-3 sm:text-sm border-gray-300 rounded-md"
                          placeholder="Company Address"
                        ></textarea>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contact Email
                          </label>
                          <div className="relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Mail className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                              type="email"
                              name="contact_email"
                              value={formData.contact_email}
                              onChange={handleChange}
                              className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 pr-3 py-2 sm:text-sm border-gray-300 rounded-md"
                              placeholder="Contact Email"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contact Phone
                          </label>
                          <div className="relative rounded-md shadow-sm">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                              <Phone className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                              type="text"
                              name="contact_phone"
                              value={formData.contact_phone}
                              onChange={handleChange}
                              className="focus:ring-indigo-500 focus:border-indigo-500 block w-full pl-10 pr-3 py-2 sm:text-sm border-gray-300 rounded-md"
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
                            ? 'bg-indigo-400'
                            : 'bg-indigo-600 hover:bg-indigo-700'
                        } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
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
