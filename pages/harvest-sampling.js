import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { ArrowLeft, Eye, CheckCircle, AlertTriangle, Info, Fish, Scale, Calendar, Calculator, BarChart3 } from 'lucide-react'
import { cageService } from '../lib/databaseService'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g above', color: 'bg-purple-100 text-purple-800' },
  { category: 'S2', range: '700g-800g', color: 'bg-blue-100 text-blue-800' },
  { category: 'S1', range: '600g-700g', color: 'bg-green-100 text-green-800' },
  { category: 'Reg', range: '500g-600g', color: 'bg-yellow-100 text-yellow-800' },
  { category: 'Eco', range: '400g-500g', color: 'bg-orange-100 text-orange-800' },
  { category: 'SS', range: '300g-400g', color: 'bg-red-100 text-red-800' },
  { category: 'SB', range: '200g-300g', color: 'bg-pink-100 text-pink-800' },
  { category: 'Rej', range: 'less than 200g', color: 'bg-gray-100 text-gray-800' }
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <div className="text-lg text-gray-700">Loading cages...</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <button
              onClick={() => router.push('/harvest')}
              className="inline-flex items-center text-indigo-600 hover:text-indigo-800 mr-4 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 mr-1" />
              Back to Harvest
            </button>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Harvest Sampling</h1>
            <p className="text-lg text-gray-600">Record detailed sampling data for harvest analysis</p>
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {success ? (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mb-6">
                <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Sampling Recorded Successfully!</h2>
                <p className="text-gray-600">Your harvest sampling data has been saved and is ready for analysis.</p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-700">
                  The sampling data will be available in your harvest reports and analytics dashboard.
                </p>
              </div>
            </div>
          ) : preview ? (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              {/* Preview Header */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                    <Eye className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Harvest Sampling Preview</h2>
                    <p className="text-indigo-100">Review your data before saving</p>
                  </div>
                </div>
              </div>

              <div className="p-8">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border border-blue-200">
                    <div className="flex items-center mb-3">
                      <Fish className="w-5 h-5 text-blue-600 mr-2" />
                      <span className="text-sm font-medium text-blue-700">Cage</span>
                    </div>
                    <div className="text-lg font-bold text-blue-900">
                      {(() => {
                        const cage = cages.find(c => c.id === form.cageId)
                        return cage ? cage.name : ''
                      })()}
                    </div>
                    <div className="text-sm text-blue-600">
                      {(() => {
                        const cage = cages.find(c => c.id === form.cageId)
                        return cage ? cage.status : ''
                      })()}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border border-green-200">
                    <div className="flex items-center mb-3">
                      <Calendar className="w-5 h-5 text-green-600 mr-2" />
                      <span className="text-sm font-medium text-green-700">Sampling Date</span>
                    </div>
                    <div className="text-lg font-bold text-green-900">{form.date}</div>
                    <div className="text-sm text-green-600">DOC: {doc} days</div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border border-purple-200">
                    <div className="flex items-center mb-3">
                      <Scale className="w-5 h-5 text-purple-600 mr-2" />
                      <span className="text-sm font-medium text-purple-700">Sample Weight</span>
                    </div>
                    <div className="text-lg font-bold text-purple-900">{form.weight}g</div>
                    <div className="text-sm text-purple-600">{form.fishCount} fish</div>
                  </div>

                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-6 border border-orange-200">
                    <div className="flex items-center mb-3">
                      <Calculator className="w-5 h-5 text-orange-600 mr-2" />
                      <span className="text-sm font-medium text-orange-700">Average Body Weight</span>
                    </div>
                    <div className="text-lg font-bold text-orange-900">{abw}g</div>
                    <div className="text-sm text-orange-600">Auto-calculated</div>
                  </div>
                </div>

                {/* Size Breakdown */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-indigo-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Size Distribution</h3>
                  </div>
                  
                  <div className="bg-gray-50 rounded-xl p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {SIZE_CATEGORIES.map(size => (
                        <div key={size.category} className="bg-white rounded-lg p-4 border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${size.color}`}>
                              {size.category}
                            </span>
                            <span className="text-lg font-bold text-gray-900">
                              {form.sizes[size.category] || 0}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">{size.range}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={() => setPreview(false)}
                    className="flex-1 px-6 py-3 border border-gray-300 rounded-xl text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                  >
                    Edit Data
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-medium rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg"
                    disabled={!!sizeSumWarning}
                  >
                    Confirm & Save
                  </button>
                </div>

                {sizeSumWarning && (
                  <div className="mt-6 flex items-center p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3" />
                    <span className="text-yellow-800">{sizeSumWarning}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              {/* Form Header */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-8 py-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                    <Fish className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Enter Sampling Data</h2>
                    <p className="text-indigo-100">Fill in the details below to record your harvest sampling</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handlePreview} className="p-8">
                {/* Sample Details Section */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Info className="w-4 h-4 text-blue-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Sample Details</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Cage Selection</label>
                        <select
                          name="cageId"
                          value={form.cageId}
                          onChange={handleChange}
                          required
                          className="block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                        >
                          <option value="">Select a cage</option>
                          {cages.map(cage => (
                            <option key={cage.id} value={cage.id}>
                              {cage.name} ({cage.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Sampling Date</label>
                        <input
                          type="date"
                          name="date"
                          value={form.date}
                          onChange={handleChange}
                          required
                          className="block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Sample Weight (g)</label>
                        <input
                          type="number"
                          name="weight"
                          value={form.weight}
                          onChange={handleChange}
                          min="1"
                          required
                          className="block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                          placeholder="Total weight of sampled fish"
                        />
                        <p className="mt-1 text-xs text-gray-500">Total weight of all sampled fish in grams</p>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Fish Count</label>
                        <input
                          type="number"
                          name="fishCount"
                          value={form.fishCount}
                          onChange={handleChange}
                          min="1"
                          required
                          className="block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                          placeholder="Number of fish sampled"
                        />
                        <p className="mt-1 text-xs text-gray-500">Number of fish in the sample</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Calculated Values */}
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
                      <div className="flex items-center mb-2">
                        <Calendar className="w-4 h-4 text-green-600 mr-2" />
                        <span className="text-sm font-medium text-green-700">Days of Culture (DOC)</span>
                      </div>
                      <div className="text-lg font-bold text-green-900">
                        {doc !== '' ? `${doc} days` : 'Not available'}
                      </div>
                    </div>
                    
                    <div className="bg-gradient-to-r from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
                      <div className="flex items-center mb-2">
                        <Calculator className="w-4 h-4 text-purple-600 mr-2" />
                        <span className="text-sm font-medium text-purple-700">Average Body Weight (ABW)</span>
                      </div>
                      <div className="text-lg font-bold text-purple-900">
                        {abw !== '' ? `${abw}g` : 'Not available'}
                      </div>
                      <div className="text-xs text-purple-600">Auto-calculated: weight ÷ count</div>
                    </div>
                  </div>
                </div>

                {/* Size Breakdown Section */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-4 h-4 text-indigo-600" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">Size Distribution</h3>
                  </div>
                  
                  <div className="bg-gray-50 rounded-xl p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {SIZE_CATEGORIES.map(size => (
                        <div key={size.category} className="bg-white rounded-lg p-4 border border-gray-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${size.color}`}>
                              {size.category}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mb-2">{size.range}</div>
                          <input
                            type="number"
                            name={size.category}
                            value={form.sizes[size.category]}
                            onChange={handleChange}
                            min="0"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="0"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-700">
                        <Info className="w-4 h-4 inline mr-1" />
                        The sum of all size counts must equal the total fish count ({form.fishCount || 0}).
                      </p>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="sticky bottom-0 bg-white py-4 border-t border-gray-200">
                  <button
                    type="submit"
                    className="w-full px-6 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg text-lg flex items-center justify-center"
                    disabled={!!sizeSumWarning}
                  >
                    <Eye className="w-5 h-5 mr-2" />
                    Preview & Confirm
                  </button>
                </div>

                {sizeSumWarning && (
                  <div className="mt-4 flex items-center p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3" />
                    <span className="text-yellow-800">{sizeSumWarning}</span>
                  </div>
                )}
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 