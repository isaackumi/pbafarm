import { useRouter } from 'next/router'
import { ArrowLeft } from 'lucide-react'

export default function Custom404() {
  const router = useRouter()
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-7xl font-extrabold text-indigo-600 mb-4">404</div>
      <div className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-2">Page Not Found</div>
      <div className="text-gray-500 dark:text-gray-300 mb-8 text-center max-w-md">
        Sorry, the page you are looking for does not exist or is still under construction.<br />
        If you think this is a mistake, please contact support.
      </div>
      <button
        onClick={() => router.back()}
        className="inline-flex items-center px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg shadow hover:bg-indigo-700 transition-colors"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Go Back
      </button>
    </div>
  )
} 