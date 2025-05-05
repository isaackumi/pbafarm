// components/BulkDailyUploadForm.js
import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import feedTypeService from '../lib/feedTypeService'
import {
  Upload,
  X,
  FileText,
  AlertCircle,
  CheckCircle,
  Download,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { useToast } from '../hooks/useToast'

const BulkDailyUploadForm = ({ companyId, onSuccess }) => {
  const { showToast } = useToast()
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(false)
  const [feedTypes, setFeedTypes] = useState([])
  const [cages, setCages] = useState([])
  const [step, setStep] = useState(1) // 1: Upload, 2: Validate, 3: Confirm
  const [file, setFile] = useState(null)
  const [records, setRecords] = useState([])
  const [errors, setErrors] = useState([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    // Load feed types and cages for validation
    const fetchData = async () => {
      try {
        // Fetch feed types
        const {
          data: feedTypesData,
          error: feedTypesError,
        } = await feedTypeService.getActiveFeedTypes()

        if (feedTypesError) throw feedTypesError

        setFeedTypes(feedTypesData || [])

        // Fetch cages
        const { data: cagesData, error: cagesError } = await supabase
          .from('cages')
          .select('id, name, status')
          .eq('company_id', companyId)
          .order('name')

        if (cagesError) throw cagesError

        setCages(cagesData || [])
      } catch (error) {
        console.error('Error loading validation data:', error)
        showToast('error', 'Failed to load validation data')
      }
    }

    fetchData()
  }, [companyId])

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return

    // Check file type
    const validFileTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ]

    if (!validFileTypes.includes(selectedFile.type)) {
      showToast('error', 'Please select a valid Excel or CSV file')
      return
    }

    setFile(selectedFile)
    parseFile(selectedFile)
  }

  const parseFile = async (file) => {
    setLoading(true)
    setErrors([])

    try {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result)
          const workbook = XLSX.read(data, { type: 'array' })

          // Get first sheet
          const worksheet = workbook.Sheets[workbook.SheetNames[0]]

          // Convert to JSON with header row
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

          // Check if file has data
          if (jsonData.length <= 1) {
            throw new Error('File contains no data or only headers')
          }

          // Extract headers
          const headers = jsonData[0].map((h) => String(h).trim().toLowerCase())

          // Check required headers
          const requiredHeaders = [
            'date',
            'cage',
            'feed_amount',
            'feed_type',
            'mortality',
          ]
          const missingHeaders = requiredHeaders.filter(
            (h) => !headers.includes(h),
          )

          if (missingHeaders.length > 0) {
            throw new Error(
              `Missing required columns: ${missingHeaders.join(', ')}`,
            )
          }

          // Process data rows
          const records = []
          const errors = []

          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i]
            if (
              row.length === 0 ||
              row.every((cell) => cell === null || cell === undefined)
            ) {
              continue
            }

            const record = {}
            let hasError = false

            // Map columns
            for (let j = 0; j < headers.length; j++) {
              const header = headers[j]
              const value = row[j] === undefined ? null : row[j]
              record[header] = value
            }

            // Validate date
            if (!record.date) {
              errors.push({ row: i + 1, message: 'Missing date' })
              hasError = true
            } else if (isNaN(Date.parse(record.date))) {
              errors.push({ row: i + 1, message: 'Invalid date format' })
              hasError = true
            }

            // Validate cage
            if (!record.cage) {
              errors.push({ row: i + 1, message: 'Missing cage' })
              hasError = true
            } else {
              // Find cage by name or ID
              const cage = cages.find(
                (c) =>
                  c.name.toLowerCase() === String(record.cage).toLowerCase() ||
                  c.id === record.cage,
              )

              if (!cage) {
                errors.push({
                  row: i + 1,
                  message: `Cage "${record.cage}" not found`,
                })
                hasError = true
              } else if (cage.status !== 'active') {
                errors.push({
                  row: i + 1,
                  message: `Cage "${record.cage}" is not active`,
                })
                hasError = true
              } else {
                record.cage_id = cage.id
              }
            }

            // Validate feed amount
            if (
              record.feed_amount === null ||
              record.feed_amount === undefined
            ) {
              errors.push({ row: i + 1, message: 'Missing feed amount' })
              hasError = true
            } else if (
              isNaN(parseFloat(record.feed_amount)) ||
              parseFloat(record.feed_amount) <= 0
            ) {
              errors.push({ row: i + 1, message: 'Invalid feed amount' })
              hasError = true
            }

            // Validate feed type
            if (!record.feed_type) {
              errors.push({ row: i + 1, message: 'Missing feed type' })
              hasError = true
            } else {
              // Find feed type by name or ID
              const feedType = feedTypes.find(
                (ft) =>
                  ft.name.toLowerCase() ===
                    String(record.feed_type).toLowerCase() ||
                  ft.id === record.feed_type,
              )

              if (!feedType) {
                errors.push({
                  row: i + 1,
                  message: `Feed type "${record.feed_type}" not found`,
                })
                hasError = true
              } else {
                record.feed_type_id = feedType.id
                record.feed_price = feedType.price_per_kg
              }
            }

            // Validate mortality (optional)
            if (record.mortality !== null && record.mortality !== undefined) {
              if (
                isNaN(parseInt(record.mortality)) ||
                parseInt(record.mortality) < 0
              ) {
                errors.push({ row: i + 1, message: 'Invalid mortality value' })
                hasError = true
              }
            } else {
              record.mortality = 0
            }

            // Add record if no errors
            if (!hasError) {
              // Calculate feed cost
              record.feed_cost =
                parseFloat(record.feed_amount) * parseFloat(record.feed_price)
              record.company_id = companyId
              records.push(record)
            }
          }

          setRecords(records)
          setErrors(errors)

          if (errors.length === 0 && records.length > 0) {
            setStep(2) // Move to confirmation step
          }
        } catch (error) {
          console.error('Error parsing file:', error)
          showToast('error', error.message || 'Error parsing file')
          setErrors([
            { row: 0, message: error.message || 'Error parsing file' },
          ])
        } finally {
          setLoading(false)
        }
      }

      reader.onerror = () => {
        showToast('error', 'Error reading file')
        setLoading(false)
      }

      reader.readAsArrayBuffer(file)
    } catch (error) {
      console.error('Error processing file:', error)
      showToast('error', 'Error processing file')
      setLoading(false)
    }
  }

  const handleUpload = async () => {
    if (records.length === 0) return

    setUploading(true)

    try {
      // Prepare records for insertion
      const dailyRecords = records.map((record) => ({
        cage_id: record.cage_id,
        date: record.date,
        feed_amount: parseFloat(record.feed_amount),
        feed_type_id: record.feed_type_id,
        feed_price: parseFloat(record.feed_price),
        feed_cost: parseFloat(record.feed_cost),
        mortality: parseInt(record.mortality),
        notes: record.notes || null,
        company_id: companyId,
      }))

      // Insert into daily_records
      const { data, error } = await supabase
        .from('daily_records')
        .insert(dailyRecords)

      if (error) throw error

      showToast(
        'success',
        `Successfully uploaded ${records.length} daily records`,
      )

      // Reset state
      setFile(null)
      setRecords([])
      setErrors([])
      setStep(1)

      // Callback
      if (onSuccess) {
        onSuccess()
      }
    } catch (error) {
      console.error('Error uploading records:', error)
      showToast('error', 'Error uploading records: ' + error.message)
    } finally {
      setUploading(false)
    }
  }

  const downloadTemplate = () => {
    // Create template spreadsheet
    const template = [
      ['date', 'cage', 'feed_amount', 'feed_type', 'mortality', 'notes'],
      ['2025-03-01', 'Cage 1', 10.5, 'Grower Feed', 0, 'Optional notes'],
      ['2025-03-02', 'Cage 2', 12.0, 'Starter Feed', 2, ''],
    ]

    const ws = XLSX.utils.aoa_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Records')

    // Generate file and trigger download
    XLSX.writeFile(wb, 'daily_records_template.xlsx')
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">Bulk Upload Daily Records</h2>
      </div>

      <div className="p-6">
        {step === 1 && (
          <div className="text-center py-6">
            <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Upload Daily Records
            </h3>
            <p className="text-sm text-gray-500 mb-6 max-w-lg mx-auto">
              Upload a CSV or Excel file containing daily feeding and mortality
              data. Make sure the file has the required columns: date, cage,
              feed_amount, feed_type, and mortality.
            </p>

            <div
              className="w-full max-w-md mx-auto border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600">
                {file ? (
                  <>
                    Selected: <span className="font-medium">{file.name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-indigo-600 font-medium">
                      Click to upload
                    </span>{' '}
                    or drag and drop
                  </>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Excel or CSV files only
              </p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".xlsx,.xls,.csv"
                className="hidden"
              />
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Template
              </button>
            </div>

            {loading && (
              <div className="mt-6 flex justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                <span className="ml-2 text-sm text-gray-600">
                  Processing file...
                </span>
              </div>
            )}

            {errors.length > 0 && (
              <div className="mt-6 bg-red-50 rounded-md p-4 max-w-lg mx-auto">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
                  <div>
                    <h4 className="text-sm font-medium text-red-800">
                      {errors.length} error{errors.length !== 1 ? 's' : ''}{' '}
                      found
                    </h4>
                    <div className="mt-2 text-sm text-red-700 max-h-40 overflow-y-auto">
                      <ul className="list-disc pl-5 space-y-1">
                        {errors.map((error, index) => (
                          <li key={index}>
                            {error.row > 0 ? `Row ${error.row}: ` : ''}
                            {error.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="bg-green-50 p-4 rounded-md mb-6">
              <div className="flex">
                <CheckCircle className="h-5 w-5 text-green-400 mr-2" />
                <div>
                  <h4 className="text-sm font-medium text-green-800">
                    Ready to upload
                  </h4>
                  <p className="mt-1 text-sm text-green-700">
                    {records.length} valid record
                    {records.length !== 1 ? 's' : ''} found. Please review and
                    confirm to upload.
                  </p>
                </div>
              </div>
            </div>

            <div className="border border-gray-200 rounded-md overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Cage
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feed Amount (kg)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feed Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feed Cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Mortality
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {records.slice(0, 10).map((record, index) => {
                    const cage = cages.find((c) => c.id === record.cage_id)
                    const feedType = feedTypes.find(
                      (ft) => ft.id === record.feed_type_id,
                    )

                    return (
                      <tr key={index}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(record.date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {cage?.name || record.cage}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {parseFloat(record.feed_amount).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {feedType?.name || record.feed_type}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          ${parseFloat(record.feed_cost).toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {record.mortality}
                        </td>
                      </tr>
                    )
                  })}

                  {records.length > 10 && (
                    <tr>
                      <td
                        colSpan="6"
                        className="px-6 py-4 text-sm text-center text-gray-500"
                      >
                        ... and {records.length - 10} more records
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                disabled={uploading}
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleUpload}
                className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  uploading
                    ? 'bg-indigo-400'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <div className="inline-block animate-spin h-4 w-4 border-2 border-white border-r-transparent rounded-full mr-2"></div>
                    Uploading...
                  </>
                ) : (
                  'Confirm Upload'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default BulkDailyUploadForm
