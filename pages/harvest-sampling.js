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
          <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-gray-800 p-6 shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <Eye className="w-5 h-5 text-green-600" />
              <span className="text-lg font-bold text-green-700">Harvest Sampling Preview</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">Cage</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{(() => {
                  const cage = cages.find(c => c.id === form.cageId)
                  return cage ? `${cage.name} (${cage.status})` : ''
                })()}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">Date</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{form.date}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">DOC</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{doc}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">Sample Weight (g)</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{form.weight}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">Fish Count</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{form.fishCount}</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded p-3 shadow-sm">
                <div className="text-xs text-gray-500 mb-1">ABW (g)</div>
                <div className="font-semibold text-gray-800 dark:text-gray-100">{abw} <span className="text-xs text-gray-400">(Auto: weight / count)</span></div>
              </div>
            </div>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-4 h-4 text-green-600" />
                <span className="font-semibold text-green-700">Size Breakdown</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border border-green-200 rounded-lg">
                  <thead className="bg-green-100 dark:bg-gray-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-green-800 dark:text-gray-100">Size</th>
                      <th className="px-3 py-2 text-left font-semibold text-green-800 dark:text-gray-100">Range</th>
                      <th className="px-3 py-2 text-left font-semibold text-green-800 dark:text-gray-100">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SIZE_CATEGORIES.map(size => (
                      <tr key={size.category} className="odd:bg-white even:bg-green-50 dark:odd:bg-gray-900 dark:even:bg-gray-800">
                        <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{size.category}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{size.range}</td>
                        <td className="px-3 py-2 text-green-700 dark:text-green-300 font-semibold">{form.sizes[size.category] || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex space-x-4 mt-6">
              <button
                onClick={() => setPreview(false)}
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold"
              >
                Edit
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 font-semibold shadow"
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
            <div className="mb-6">
              <div className="text-lg font-bold text-green-700 mb-2 flex items-center gap-2">
                <Info className="w-5 h-5 text-green-600" /> Sample Details
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-green-50 dark:bg-gray-800 p-4 rounded-lg">
                <div>
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
                <div>
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
                <div>
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
                  <span className="text-xs text-gray-500">Total weight of all sampled fish (in grams).</span>
                </div>
                <div>
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
                  <span className="text-xs text-gray-500">Number of fish sampled.</span>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">DOC</label>
                  <div className="font-semibold text-gray-800 dark:text-gray-100">{doc !== '' ? doc : '-'}</div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500">ABW (g)</label>
                  <div className="font-semibold text-gray-800 dark:text-gray-100">{abw !== '' ? abw : '-'} <span className="text-xs text-gray-400">(Auto: weight / count)</span></div>
                </div>
              </div>
            </div>
            <div className="mb-6">
              <div className="text-lg font-bold text-green-700 mb-2 flex items-center gap-2">
                <Info className="w-5 h-5 text-green-600" /> Size Breakdown
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-green-50 dark:bg-gray-800 p-4 rounded-lg">
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
            <div className="sticky bottom-0 bg-white dark:bg-gray-900 py-4 z-10">
              <button
                type="submit"
                className="w-full px-4 py-2 rounded bg-green-600 text-white font-semibold hover:bg-green-700 flex items-center justify-center shadow-lg text-lg"
                disabled={!!sizeSumWarning}
              >
                <Eye className="w-5 h-5 mr-2" />
                Preview
              </button>
            </div>
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