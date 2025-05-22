// pages/bulk-upload.js
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar, FileText } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import BulkDailyUploadForm from '../components/BulkDailyUploadForm'
import { ToastProvider } from '../components/Toast'

export default function BulkUploadPage() {
  const [activeTab, setActiveTab] = useState('daily')

  return (
    <ProtectedRoute>
      <ToastProvider>
        <div className="min-h-screen bg-gray-100 font-montserrat">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center mb-6">
              <Link
                href="/dashboard"
                className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                Bulk Data Upload
              </h1>
            </div>

            <div className="mb-6">
              <p className="text-gray-600">
                Upload multiple records at once using Excel or CSV files. Select
                the type of data you want to upload.
              </p>
            </div>

            {/* Tab Navigation */}
            <div className="bg-white shadow rounded-lg mb-6">
              <div className="border-b border-gray-200">
                <nav className="flex">
                  <button
                    onClick={() => setActiveTab('daily')}
                    className={`px-4 py-4 text-sm font-medium ${
                      activeTab === 'daily'
                        ? 'border-b-2 border-indigo-500 text-indigo-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 mr-2" />
                      Daily Records
                    </div>
                  </button>
                  <button
                    onClick={() => setActiveTab('biweekly')}
                    className={`px-4 py-4 text-sm font-medium ${
                      activeTab === 'biweekly'
                        ? 'border-b-2 border-indigo-500 text-indigo-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <div className="flex items-center">
                      <FileText className="h-4 w-4 mr-2" />
                      Biweekly ABW (Coming Soon)
                    </div>
                  </button>
                </nav>
              </div>
            </div>

            {/* Tab Content */}
            <div>
              {activeTab === 'daily' && <BulkDailyUploadForm />}

              {activeTab === 'biweekly' && (
                <div className="bg-white shadow rounded-lg p-8 text-center">
                  <div className="text-gray-500">
                    <FileText className="h-16 w-16 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Biweekly ABW Bulk Upload
                    </h3>
                    <p className="mb-4">
                      This feature is coming soon. You'll be able to upload
                      multiple biweekly average body weight records at once.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </ToastProvider>
    </ProtectedRoute>
  )
}
