import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { ArrowLeft, Eye, CheckCircle, AlertTriangle, Info } from 'lucide-react'
import { cageService } from '../lib/databaseService'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g above' },
  { category: 'S2', range: '700g-800g' },
  { category: 'S1', range: '600g-700g' },
  { category: 'Reg', range: '500g-600g' },
  { category: 'Eco', range: '400g-500g' },
  { category: 'SS', range: '300g-400g' },
  { category: 'SB', range: '200g-300g' },
  { category: 'Rej', range: 'less than 200g' }
]

export default function HarvestSampling() {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [form, setForm] = useState({
    cageId: '',
    date: '',
    weight: '',
    fishCount: '',
    sizes: SIZE_CATEGORIES.reduce((acc, size) => ({ ...acc, [size.category]: '' }), {})
  })
  const [doc, setDoc] = useState('')
  const [abw, setAbw] = useState('')
  const [preview, setPreview] = useState(false)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sizeSumWarning, setSizeSumWarning] = useState('')

  useEffect(() => {
    async function fetchCages() {
      setLoading(true)
      const { data, error } = await cageService.getActiveCages()
      setCages(data || [])
      setLoading(false)
    }
    fetchCages()
  }, [])

  // Calculate DOC and ABW
  useEffect(() => {
    if (form.cageId && form.date) {
      const cage = cages.find(c => c.id === form.cageId)
      if (cage && cage.stocking_date) {
        const stockingDate = new Date(cage.stocking_date)
        const sampleDate = new Date(form.date)
        const days = Math.floor((sampleDate - stockingDate) / (1000 * 60 * 60 * 24))
        setDoc(days >= 0 ? days : '')
      } else {
        setDoc('')
      }
    } else {
      setDoc('')
    }
    if (form.weight && form.fishCount) {
      const abwVal = parseFloat(form.weight) / parseInt(form.fishCount)
      setAbw(isFinite(abwVal) && abwVal > 0 ? abwVal.toFixed(2) : '')
    } else {
      setAbw('')
    }
  }, [form, cages])

  // Validate size sum
  useEffect(() => {
    const total = SIZE_CATEGORIES.reduce((sum, size) => sum + (parseInt(form.sizes[size.category]) || 0), 0)
    if (form.fishCount && total !== parseInt(form.fishCount)) {
      setSizeSumWarning('Sum of size counts does not match total fish count.')
    } else {
      setSizeSumWarning('')
    }
  }, [form.sizes, form.fishCount])

  const handleChange = (e) => {
    const { name, value } = e.target
    if (SIZE_CATEGORIES.some(size => size.category === name)) {
      setForm(prev => ({ ...prev, sizes: { ...prev.sizes, [name]: value } }))
    } else {
      setForm(prev => ({ ...prev, [name]: value }))
    }
  }

  const handlePreview = (e) => {
    e.preventDefault()
    setPreview(true)
  }

  const handleConfirm = () => {
    setSuccess(true)
    setTimeout(() => {
      setSuccess(false)
      setPreview(false)
      setForm({ cageId: '', date: '', weight: '', fishCount: '', sizes: SIZE_CATEGORIES.reduce((acc, size) => ({ ...acc, [size.category]: '' }), {}) })
      setDoc('')
      setAbw('')
    }, 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-lg text-gray-700 dark:text-gray-200">Loading cages...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-green-50 to-green-100 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow p-8">
        <div className="flex items-center mb-6">
          <button
            onClick={() => router.push('/harvest')}
            className="inline-flex items-center text-green-700 hover:text-green-900 mr-4"
          >
            <ArrowLeft className="w-5 h-5 mr-1" />
            Back
          </button>
          <h2 className="text-2xl font-bold text-green-700">Harvest Sampling</h2>
        </div>
        {success ? (
          <div className="flex flex-col items-center justify-center py-12">
            <CheckCircle className="w-12 h-12 text-green-500 mb-2" />
            <div className="text-lg font-semibold text-green-700 mb-2">Sampling Recorded!</div>
            <div className="text-gray-500">Your harvest sampling data has been saved.</div>
          </div>
        ) : preview ? (
          <div>
            <div className="mb-6">
              <div className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Preview</div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded p-4 space-y-2">
                <div><span className="font-medium">Cage:</span> {(() => {
                  const cage = cages.find(c => c.id === form.cageId)
                  return cage ? `${cage.name} (${cage.status})` : ''
                })()}</div>
                <div><span className="font-medium">Date:</span> {form.date}</div>
                <div><span className="font-medium">DOC:</span> {doc}</div>
                <div><span className="font-medium">Sample Weight (g):</span> {form.weight}</div>
                <div><span className="font-medium">Fish Count:</span> {form.fishCount}</div>
                <div><span className="font-medium">ABW (g):</span> {abw} <span className="text-xs text-gray-400">(Auto-calculated: weight / count)</span></div>
                <div><span className="font-medium">Size Breakdown:</span>
                  <ul className="ml-4 list-disc grid grid-cols-2 gap-x-4">
                    {SIZE_CATEGORIES.map(size => (
                      <li key={size.category}>{size.category} ({size.range}): {form.sizes[size.category] || 0}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="flex space-x-4">
              <button
                onClick={() => setPreview(false)}
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Edit
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
                disabled={!!sizeSumWarning}
              >
                Confirm & Save
              </button>
            </div>
            {sizeSumWarning && (
              <div className="mt-4 flex items-center text-yellow-700 bg-yellow-100 rounded p-2">
                <AlertTriangle className="w-4 h-4 mr-2" />
                {sizeSumWarning}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handlePreview}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cage</label>
              <select
                name="cageId"
                value={form.cageId}
                onChange={handleChange}
                required
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              >
                <option value="">Select a cage</option>
                {cages.map(cage => (
                  <option key={cage.id} value={cage.id}>{cage.name} ({cage.status})</option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                name="date"
                value={form.date}
                onChange={handleChange}
                required
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Sample Weight (g)</label>
              <input
                type="number"
                name="weight"
                value={form.weight}
                onChange={handleChange}
                min="1"
                required
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Fish Count</label>
              <input
                type="number"
                name="fishCount"
                value={form.fishCount}
                onChange={handleChange}
                min="1"
                required
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
              />
            </div>
            <div className="mb-4">
              <div className="flex items-center mb-1">
                <label className="block text-sm font-medium text-gray-700">Size Breakdown</label>
                <Info className="w-4 h-4 text-gray-400 ml-2" title="Enter the count of fish in each size category. The sum must match the total fish count." />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-md">
                {SIZE_CATEGORIES.map(size => (
                  <div key={size.category} className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-600 mb-1">{size.category} <span className="text-gray-400">({size.range})</span></span>
                    <input
                      type="number"
                      name={size.category}
                      value={form.sizes[size.category]}
                      onChange={handleChange}
                      min="0"
                      className="w-full px-2 py-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-green-500 focus:border-green-500 sm:text-sm"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">Sum of all size counts must equal the total fish count.</p>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500">DOC</label>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{doc !== '' ? doc : '-'}</div>
              </div>
              <div>
                <label className="block text-xs text-gray-500">ABW (g)</label>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{abw !== '' ? abw : '-'} <span className="text-xs text-gray-400">(Auto: weight / count)</span></div>
              </div>
            </div>
            <button
              type="submit"
              className="w-full mt-4 px-4 py-2 rounded bg-green-600 text-white font-semibold hover:bg-green-700 flex items-center justify-center"
              disabled={!!sizeSumWarning}
            >
              <Eye className="w-5 h-5 mr-2" />
              Preview
            </button>
            {sizeSumWarning && (
              <div className="mt-4 flex items-center text-yellow-700 bg-yellow-100 rounded p-2">
                <AlertTriangle className="w-4 h-4 mr-2" />
                {sizeSumWarning}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
} 