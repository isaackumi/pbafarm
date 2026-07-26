// pages/bulk-upload.js
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar, FileText } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import BulkDailyUploadForm from '../components/BulkDailyUploadForm'
import BulkBiweeklyUploadForm from '../components/BulkBiweeklyUploadForm'
import { ToastProvider } from '../components/Toast'

export default function BulkUploadPage() {
  const [activeTab, setActiveTab] = useState('daily')

  return (
    <ProtectedRoute requiredRole="admin">
      <ToastProvider>
        <div className="min-h-screen bg-foam font-sans">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center mb-6">
              <Link
                href="/dashboard"
                className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Dashboard
              </Link>
              <h1 className="text-2xl font-bold text-chart-ink">
                Bulk Data Upload
              </h1>
            </div>

            <div className="mb-6">
              <p className="text-muted">
                Upload multiple records at once using CSV files.
              </p>
            </div>

            <div className="page-card mb-6">
              <div className="border-b border-foam-deep">
                <nav className="flex">
                  <button
                    type="button"
                    onClick={() => setActiveTab('daily')}
                    className={`px-4 py-4 text-sm font-medium ${
                      activeTab === 'daily'
                        ? 'border-b-2 border-lagoon-800 text-lagoon-800'
                        : 'text-muted hover:text-chart-ink'
                    }`}
                  >
                    <div className="flex items-center">
                      <Calendar className="h-4 w-4 mr-2" />
                      Daily Records
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('biweekly')}
                    className={`px-4 py-4 text-sm font-medium ${
                      activeTab === 'biweekly'
                        ? 'border-b-2 border-lagoon-800 text-lagoon-800'
                        : 'text-muted hover:text-chart-ink'
                    }`}
                  >
                    <div className="flex items-center">
                      <FileText className="h-4 w-4 mr-2" />
                      Biweekly ABW
                    </div>
                  </button>
                </nav>
              </div>
            </div>

            <div>
              {activeTab === 'daily' && <BulkDailyUploadForm />}
              {activeTab === 'biweekly' && <BulkBiweeklyUploadForm />}
            </div>
          </div>
        </div>
      </ToastProvider>
    </ProtectedRoute>
  )
}
