// components/BulkUploadModal.js
import React, { useState, useRef, useEffect } from 'react'
import {
  Upload,
  X,
  FileText,
  AlertCircle,
  CheckCircle,
  Download,
} from 'lucide-react'
import { useToast } from '../hooks/useToast'

const BulkUploadModal = ({
  isOpen,
  onClose,
  onUpload,
  recordType = 'feed',
  templateHeaders = [],
  validationRules = {},
  maxRows = 100,
  templateData = null,
  cages = [],
  feedTypes = [],
}) => {
  const fileInputRef = useRef(null)
  const { showToast } = useToast()

  const [fileData, setFileData] = useState(null)
  const [parsedData, setParsedData] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [processing, setProcessing] = useState(false)
  const [step, setStep] = useState(1) // 1: Upload, 2: Preview, 3: Confirm
  const [xlsxLibLoaded, setXlsxLibLoaded] = useState(false)
  const [xlsxLib, setXlsxLib] = useState(null)

  // Dynamically import xlsx library
  useEffect(() => {
    async function loadXlsx() {
      try {
        const XLSX = await import('xlsx')
        setXlsxLib(XLSX)
        setXlsxLibLoaded(true)
      } catch (error) {
        console.error('Failed to load xlsx library:', error)
        showToast(
          'error',
          'Failed to load Excel parsing library. Please make sure xlsx is installed.',
        )
      }
    }

    if (isOpen) {
      loadXlsx()
    }
  }, [isOpen, showToast])

  const resetState = () => {
    setFileData(null)
    setParsedData([])
    setValidationErrors([])
    setProcessing(false)
    setStep(1)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return

    // Check file type
    const validTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ]

    if (!validTypes.includes(file.type)) {
      showToast(
        'error',
        'Invalid file type. Please upload an Excel or CSV file.',
      )
      return
    }

    setFileData(file)
    parseFile(file)
  }

  const parseFile = async (file) => {
    if (!xlsxLibLoaded || !xlsxLib) {
      showToast(
        'error',
        'Excel parsing library not loaded. Please try again or check installation.',
      )
      return
    }

    setProcessing(true)
    setValidationErrors([])

    try {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result)
          const workbook = xlsxLib.read(data, { type: 'array' })

          // Get first sheet
          const worksheet = workbook.Sheets[workbook.SheetNames[0]]

          // Convert to JSON with header row
          const jsonData = xlsxLib.utils.sheet_to_json(worksheet, { header: 1 })

          // Check if file has data
          if (jsonData.length <= 1) {
            throw new Error('File contains no data or only headers')
          }

          // Check row limit
          if (jsonData.length > maxRows + 1) {
            // +1 for header row
            throw new Error(`File contains too many rows (maximum ${maxRows})`)
          }

          // Extract headers (first row)
          const headers = jsonData[0].map((h) =>
            typeof h === 'string'
              ? h.trim().toLowerCase()
              : String(h).toLowerCase(),
          )

          // Validate headers against expected template
          const missingHeaders = templateHeaders.filter(
            (header) => !headers.some((h) => h === header.toLowerCase()),
          )

          if (missingHeaders.length > 0) {
            throw new Error(
              `Missing required columns: ${missingHeaders.join(', ')}`,
            )
          }

          // Process data rows (skip header)
          const records = jsonData.slice(1).map((row, index) => {
            // Create object with header keys
            const record = {}
            headers.forEach((header, i) => {
              // Use lowercase header as key
              record[header] = row[i] || null
            })

            return record
          })

          // Validate each record
          const errors = []
          records.forEach((record, index) => {
            const rowErrors = validateRecord(record, index + 2) // +2 for 1-based indexing and header row
            if (rowErrors.length > 0) {
              errors.push(...rowErrors)
            }
          })

          setValidationErrors(errors)
          setParsedData(records)
          setStep(2) // Move to preview step
        } catch (error) {
          console.error('Error parsing file:', error)
          showToast('error', error.message || 'Error parsing file')
          resetState()
        }
      }

      reader.onerror = () => {
        showToast('error', 'Error reading file')
        resetState()
      }

      reader.readAsArrayBuffer(file)
    } catch (error) {
      console.error('Error processing file:', error)
      showToast('error', 'Error processing file')
      resetState()
    } finally {
      setProcessing(false)
    }
  }

  const validateRecord = (record, rowNumber) => {
    const errors = []

    // Apply validation rules
    Object.entries(validationRules).forEach(([field, rules]) => {
      // Skip if field not in record
      if (!(field in record)) return

      const value = record[field]

      // Required check
      if (
        rules.required &&
        (value === null || value === undefined || value === '')
      ) {
        errors.push({
          row: rowNumber,
          field,
          message: `${field} is required`,
        })
        return // Skip other validations for this field
      }

      // Type validations
      if (value !== null && value !== undefined && value !== '') {
        if (rules.type === 'number' && isNaN(Number(value))) {
          errors.push({
            row: rowNumber,
            field,
            message: `${field} must be a number`,
          })
        } else if (rules.type === 'date' && isNaN(Date.parse(value))) {
          errors.push({
            row: rowNumber,
            field,
            message: `${field} must be a valid date`,
          })
        }

        // Min/Max for numbers
        if (rules.type === 'number' && !isNaN(Number(value))) {
          const numValue = Number(value)
          if (rules.min !== undefined && numValue < rules.min) {
            errors.push({
              row: rowNumber,
              field,
              message: `${field} must be at least ${rules.min}`,
            })
          }
          if (rules.max !== undefined && numValue > rules.max) {
            errors.push({
              row: rowNumber,
              field,
              message: `${field} must be at most ${rules.max}`,
            })
          }
        }
      }
    })

    // Add specific validations for cage_name and feed_type
    if ('cage_name' in record && record.cage_name) {
      const cageExists = cages.some(
        (cage) =>
          cage.name.toLowerCase().trim() ===
          record.cage_name.toLowerCase().trim(),
      )

      if (!cageExists) {
        errors.push({
          row: rowNumber,
          field: 'cage_name',
          message: `Cage name "${record.cage_name}" does not exist in the system`,
        })
      }
    }

    if ('feed_type' in record && record.feed_type) {
      const feedTypeExists = feedTypes.some(
        (ft) =>
          ft.name.toLowerCase().trim() ===
          record.feed_type.toLowerCase().trim(),
      )

      if (!feedTypeExists) {
        errors.push({
          row: rowNumber,
          field: 'feed_type',
          message: `Feed type "${record.feed_type}" does not exist in the system`,
        })
      }
    }

    return errors
  }

  const handleConfirmUpload = async () => {
    if (validationErrors.length > 0) {
      showToast('error', 'Please fix validation errors before uploading')
      return
    }

    setProcessing(true)

    try {
      // Process the data through the provided callback
      await onUpload(parsedData)

      showToast('success', `Successfully uploaded ${parsedData.length} records`)
      handleClose()
    } catch (error) {
      console.error('Error uploading data:', error)
      showToast('error', error.message || 'Error uploading data')
    } finally {
      setProcessing(false)
    }
  }

  const downloadTemplate = () => {
    if (!xlsxLibLoaded || !xlsxLib) {
      showToast(
        'error',
        'Excel parsing library not loaded. Please try again or check installation.',
      )
      return
    }

    try {
      // Create worksheet with headers
      const ws = xlsxLib.utils.aoa_to_sheet([templateHeaders])

      // Add sample data if provided
      if (
        templateData &&
        templateData.exampleData &&
        templateData.exampleData.length > 0
      ) {
        xlsxLib.utils.sheet_add_aoa(ws, templateData.exampleData, {
          origin: 'A2',
        })
      } else if (cages.length > 0 && feedTypes.length > 0) {
        // Fallback: Create example row with actual cage and feed type from the system
        const exampleRow = [
          cages[0].name,
          new Date().toISOString().split('T')[0],
          '1.5',
          feedTypes[0].name,
          feedTypes[0].price_per_kg?.toString() || '1.5',
          '0',
          'Sample record',
        ]
        xlsxLib.utils.sheet_add_aoa(ws, [exampleRow], { origin: 'A2' })
      }

      // Create workbook and add the worksheet
      const wb = xlsxLib.utils.book_new()
      xlsxLib.utils.book_append_sheet(wb, ws, 'Template')

      // Generate Excel file and trigger download
      xlsxLib.writeFile(wb, `${recordType}_import_template.xlsx`)
    } catch (error) {
      console.error('Error generating template:', error)
      showToast('error', 'Error generating template')
    }
  }

  // If modal is not open, don't render anything
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={handleClose}
      ></div>
      <div className="relative bg-white rounded-lg max-w-4xl w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">
            Bulk Upload -{' '}
            {recordType.charAt(0).toUpperCase() + recordType.slice(1)}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center">
            <div
              className={`flex items-center ${
                step >= 1 ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <div
                className={`rounded-full h-6 w-6 flex items-center justify-center ${
                  step >= 1 ? 'bg-indigo-100' : 'bg-gray-100'
                }`}
              >
                <span className="text-sm font-medium">1</span>
              </div>
              <span className="ml-2 text-sm font-medium">Upload</span>
            </div>
            <div
              className={`w-10 h-0.5 mx-2 ${
                step >= 2 ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            ></div>
            <div
              className={`flex items-center ${
                step >= 2 ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <div
                className={`rounded-full h-6 w-6 flex items-center justify-center ${
                  step >= 2 ? 'bg-indigo-100' : 'bg-gray-100'
                }`}
              >
                <span className="text-sm font-medium">2</span>
              </div>
              <span className="ml-2 text-sm font-medium">Preview</span>
            </div>
            <div
              className={`w-10 h-0.5 mx-2 ${
                step >= 3 ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            ></div>
            <div
              className={`flex items-center ${
                step >= 3 ? 'text-indigo-600' : 'text-gray-400'
              }`}
            >
              <div
                className={`rounded-full h-6 w-6 flex items-center justify-center ${
                  step >= 3 ? 'bg-indigo-100' : 'bg-gray-100'
                }`}
              >
                <span className="text-sm font-medium">3</span>
              </div>
              <span className="ml-2 text-sm font-medium">Confirm</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {!xlsxLibLoaded && (
            <div className="bg-yellow-50 p-4 mb-6 rounded-md">
              <div className="flex">
                <AlertCircle className="h-5 w-5 text-yellow-400 mr-2" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">
                    Excel parsing library not loaded
                  </p>
                  <p className="text-sm text-yellow-700 mt-1">
                    The XLSX library required for parsing Excel files is not
                    installed or failed to load. Please install it using{' '}
                    <code>npm install xlsx</code> or <code>yarn add xlsx</code>
                    and restart your application.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-6">
              <FileText className="h-16 w-16 text-gray-400 mb-4" />
              <h4 className="text-lg font-medium text-gray-900 mb-2">
                Upload Excel or CSV File
              </h4>
              <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
                Please upload an Excel or CSV file containing your {recordType}{' '}
                data. Make sure it follows the required template format.
              </p>

              <div className="flex flex-col items-center w-full max-w-md">
                <div
                  className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 transition-colors"
                  onClick={() => xlsxLibLoaded && fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">
                    {fileData ? (
                      <>
                        Selected:{' '}
                        <span className="font-medium">{fileData.name}</span>
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
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    disabled={!xlsxLibLoaded}
                  />
                </div>

                <div className="mt-6 flex justify-between w-full">
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    disabled={!xlsxLibLoaded}
                    className={`inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 ${
                      !xlsxLibLoaded ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </button>

                  <button
                    type="button"
                    onClick={() => fileData && setStep(2)}
                    disabled={!fileData || processing || !xlsxLibLoaded}
                    className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                      !fileData || processing || !xlsxLibLoaded
                        ? 'bg-indigo-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    {processing ? 'Processing...' : 'Continue'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-4">
                <h4 className="text-lg font-medium text-gray-900 mb-2">
                  Preview Data
                </h4>
                <p className="text-sm text-gray-500">
                  Review the data before uploading. Found {parsedData.length}{' '}
                  records.
                </p>
              </div>

              {validationErrors.length > 0 && (
                <div className="mb-4 bg-red-50 p-4 rounded-md">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 text-red-500 mr-2 mt-0.5" />
                    <div>
                      <h5 className="text-sm font-medium text-red-800 mb-1">
                        Validation Errors ({validationErrors.length})
                      </h5>
                      <div className="text-sm text-red-700 max-h-32 overflow-y-auto">
                        <ul className="list-disc pl-5">
                          {validationErrors.slice(0, 10).map((error, index) => (
                            <li key={index}>
                              Row {error.row}: {error.field} - {error.message}
                            </li>
                          ))}
                          {validationErrors.length > 10 && (
                            <li>
                              ... and {validationErrors.length - 10} more errors
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-gray-200 rounded-md overflow-hidden max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        Row
                      </th>
                      {templateHeaders.map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {parsedData.slice(0, 100).map((record, index) => (
                      <tr
                        key={index}
                        className={
                          validationErrors.some((e) => e.row === index + 2)
                            ? 'bg-red-50'
                            : index % 2 === 0
                            ? 'bg-white'
                            : 'bg-gray-50'
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                          {index + 2}
                        </td>
                        {templateHeaders.map((header) => {
                          const key = header.toLowerCase()
                          const hasError = validationErrors.some(
                            (e) =>
                              e.row === index + 2 &&
                              e.field.toLowerCase() === key,
                          )

                          return (
                            <td
                              key={`${index}-${key}`}
                              className={`px-3 py-2 whitespace-nowrap text-xs ${
                                hasError
                                  ? 'text-red-800 font-medium'
                                  : 'text-gray-500'
                              }`}
                            >
                              {record[key] !== null &&
                              record[key] !== undefined ? (
                                String(record[key])
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {parsedData.length > 100 && (
                      <tr>
                        <td
                          colSpan={templateHeaders.length + 1}
                          className="px-3 py-2 text-xs text-center text-gray-500"
                        >
                          ... {parsedData.length - 100} more rows not shown
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={processing || validationErrors.length > 0}
                  className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    processing || validationErrors.length > 0
                      ? 'bg-indigo-400 cursor-not-allowed'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {validationErrors.length > 0
                    ? 'Fix Errors to Continue'
                    : 'Continue to Confirmation'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="bg-green-50 p-4 rounded-md mb-6">
                <div className="flex">
                  <CheckCircle className="h-5 w-5 text-green-500 mr-2 mt-0.5" />
                  <div>
                    <h5 className="text-sm font-medium text-green-800 mb-1">
                      Ready to Import
                    </h5>
                    <p className="text-sm text-green-700">
                      You're about to upload {parsedData.length} {recordType}{' '}
                      records. This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-md mb-6">
                <h5 className="text-sm font-medium text-gray-800 mb-2">
                  Import Summary
                </h5>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Records to import:</span>{' '}
                    {parsedData.length}
                  </div>
                  <div>
                    <span className="font-medium">File name:</span>{' '}
                    {fileData?.name}
                  </div>
                  <div>
                    <span className="font-medium">File size:</span>{' '}
                    {Math.round(fileData?.size / 1024)} KB
                  </div>
                  <div>
                    <span className="font-medium">Import type:</span>{' '}
                    {recordType}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={processing}
                  className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    processing
                      ? 'bg-green-400'
                      : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  {processing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : (
                    'Confirm Import'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BulkUploadModal
