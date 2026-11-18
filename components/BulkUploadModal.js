// components/BulkUploadModal.js
import React, { useState, useRef, useEffect } from 'react'
import {
  Upload,
  X,
  AlertCircle,
  CheckCircle,
  Download,
  Eye,
  EyeOff,
  Loader,
} from 'lucide-react'
import { useToast } from './Toast'
import { Button } from './ui'
import * as XLSX from 'xlsx'

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
  const [showErrors, setShowErrors] = useState(false)
  const [xlsxLibLoaded, setXlsxLibLoaded] = useState(true) // Set to true since we're using static import

  // Set XLSX library as loaded since we're using static import
  useEffect(() => {
    setXlsxLibLoaded(true)
  }, [])

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
    if (!xlsxLibLoaded) {
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
          const workbook = XLSX.read(data, { type: 'array' })

          // Get first sheet
          const worksheet = workbook.Sheets[workbook.SheetNames[0]]

          // Convert to JSON with header row
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

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
              // Clean and trim string values
              let value = row[i]
              if (typeof value === 'string') {
                value = value.trim()
              }
              // Use lowercase header as key
              record[header] = value || null
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
        } else if (rules.type === 'date') {
          // Handle various date formats
          let parsedDate
          if (value instanceof Date) {
            parsedDate = value
          } else if (!isNaN(value)) {
            // Handle Excel date format (numeric value)
            parsedDate = new Date((value - 25569) * 86400 * 1000)
          } else {
            // Try parsing DD/MM/YYYY or DD-MM-YYYY format
            const parts = value.split(/[-\/]/)
            if (parts.length === 3) {
              const [day, month, year] = parts
              parsedDate = new Date(year, month - 1, day)
            } else {
              parsedDate = new Date(value)
            }
          }

          if (isNaN(parsedDate.getTime())) {
            errors.push({
              row: rowNumber,
              field,
              message: `${field} must be a valid date (DD/MM/YYYY or DD-MM-YYYY)`,
            })
          }
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

    // Add specific validations for cage_code and feed_type
    if ('cage_code' in record && record.cage_code) {
      const cage = cages.find(
        (cage) => cage.code.toLowerCase() === record.cage_code.toLowerCase().trim(),
      )

      if (!cage) {
        errors.push({
          row: rowNumber,
          field: 'cage_code',
          message: `Cage code "${record.cage_code}" does not exist in the system`,
        })
      } else if (cage.status !== 'active') {
        errors.push({
          row: rowNumber,
          field: 'cage_code',
          message: `Cage "${record.cage_code}" is not active. Only active cages are allowed for data entry.`,
        })
      }
    }

    // If cage_code is valid and cage_name is provided, verify it matches (warning only)
    if (
      'cage_code' in record &&
      record.cage_code &&
      'cage_name' in record &&
      record.cage_name
    ) {
      const cage = cages.find((cage) => cage.code === record.cage_code.trim())
      if (
        cage &&
        cage.name.toLowerCase() !== record.cage_name.trim().toLowerCase()
      ) {
        console.warn(
          `Row ${rowNumber}: Provided cage name "${record.cage_name}" doesn't match the name "${cage.name}" for cage code "${record.cage_code}".`,
        )
        // This is just a warning, not blocking error
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
    if (!xlsxLibLoaded) {
      showToast(
        'error',
        'Excel parsing library not loaded. Please try again or check installation.',
      )
      return
    }

    try {
      // Create workbook and worksheet
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet([
        templateHeaders,
        ...(templateData?.exampleData || []),
      ])

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Template')

      // Generate filename
      const filename = `${recordType}_template.xlsx`

      // Save file
      XLSX.writeFile(wb, filename)
    } catch (error) {
      console.error('Error generating template:', error)
      showToast('error', 'Error generating template file')
    }
  }

  // If modal is not open, don't render anything
  if (!isOpen) return null

  const steps = ['Upload', 'Preview', 'Confirm']

  return (
    <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 modal-backdrop"
        onClick={handleClose}
      ></div>
      <div className="relative bg-surface rounded-xl border border-foam-deep shadow-xl max-w-4xl w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-foam-deep flex justify-between items-center gap-3">
          <h3 className="font-display text-lg font-medium text-chart-ink">
            Bulk upload: {recordType}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg text-muted hover:text-chart-ink hover:bg-foam focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step indicator */}
        <ol className="px-6 py-3 bg-foam border-b border-foam-deep flex items-center">
          {steps.map((label, i) => {
            const n = i + 1
            const reached = step >= n
            return (
              <li key={label} className="flex items-center">
                {i > 0 && (
                  <span
                    aria-hidden
                    className={`w-6 sm:w-10 h-0.5 mx-2 ${reached ? 'bg-lake' : 'bg-foam-deep'}`}
                  />
                )}
                <span
                  className={`flex items-center ${reached ? 'text-lake' : 'text-muted'}`}
                  aria-current={step === n ? 'step' : undefined}
                >
                  <span
                    className={`rounded-full h-6 w-6 flex items-center justify-center text-sm font-medium tabular-nums ${
                      reached ? 'bg-lake text-white' : 'bg-surface border border-foam-deep'
                    }`}
                  >
                    {n}
                  </span>
                  <span className="ml-2 text-sm font-medium">{label}</span>
                </span>
              </li>
            )
          })}
        </ol>

        {/* Content */}
        <div className="p-6">
          {!xlsxLibLoaded && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-4 mb-6 rounded-lg">
              <div className="flex">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300 mr-2" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Excel parsing library not loaded
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
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
              <h4 className="font-display text-lg font-medium text-chart-ink mb-2">
                Upload an Excel or CSV file
              </h4>
              <p className="text-sm text-muted mb-6 text-center max-w-md">
                The file should hold your {recordType} data in the template
                format. Download the template if you need it.
              </p>

              <div className="flex flex-col items-center w-full max-w-md">
                <div
                  className="w-full border-2 border-dashed border-input-border rounded-xl p-6 text-center cursor-pointer hover:border-lake transition-colors"
                  onClick={() => xlsxLibLoaded && fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted mx-auto mb-2" />
                  <p className="text-sm text-muted">
                    {fileData ? (
                      <>
                        Selected:{' '}
                        <span className="font-medium">{fileData.name}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-lake font-medium">
                          Click to upload
                        </span>{' '}
                        or drag and drop
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted mt-1">
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

                <div className="mt-6 flex flex-wrap justify-between gap-3 w-full">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={downloadTemplate}
                    disabled={!xlsxLibLoaded}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Download template
                  </Button>

                  <Button
                    type="button"
                    onClick={() => fileData && setStep(2)}
                    disabled={!fileData || processing || !xlsxLibLoaded}
                  >
                    {processing ? 'Processing…' : 'Continue'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-4">
                <h4 className="font-display text-lg font-medium text-chart-ink mb-2">
                  Preview
                </h4>
                <p className="text-sm text-muted tabular-nums">
                  Review the data before uploading. Found {parsedData.length}{' '}
                  records.
                </p>
              </div>

              {validationErrors.length > 0 && (
                <div className="mb-4 bg-signal/10 border border-signal/30 p-4 rounded-lg">
                  <div className="flex items-start">
                    <AlertCircle className="h-5 w-5 shrink-0 text-signal mr-2 mt-0.5" />
                    <div>
                      <h5 className="text-sm font-medium text-signal mb-1">
                        {validationErrors.length} rows need fixing
                      </h5>
                      <div className="text-sm text-signal max-h-32 overflow-y-auto">
                        <ul className="list-disc pl-5">
                          {validationErrors.slice(0, 10).map((error, index) => (
                            <li key={index}>
                              Row {error.row}: {error.field} - {error.message}
                            </li>
                          ))}
                          {validationErrors.length > 10 && (
                            <li>
                              …and {validationErrors.length - 10} more
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="border border-foam-deep rounded-lg max-h-96 overflow-auto">
                <table className="min-w-full divide-y divide-foam-deep">
                  <thead className="bg-foam sticky top-0">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2 text-left text-xs font-medium text-muted"
                      >
                        Row
                      </th>
                      {templateHeaders.map((header) => (
                        <th
                          key={header}
                          scope="col"
                          className="px-3 py-2 text-left text-xs font-medium text-muted"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-surface divide-y divide-foam-deep">
                    {parsedData.slice(0, 100).map((record, index) => (
                      <tr
                        key={index}
                        className={
                          validationErrors.some((e) => e.row === index + 2)
                            ? 'bg-signal/10'
                            : index % 2 === 0
                            ? 'bg-surface'
                            : 'bg-foam'
                        }
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-muted tabular-nums">
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
                                  ? 'text-signal font-medium'
                                  : 'text-chart-ink'
                              }`}
                            >
                              {record[key] !== null &&
                              record[key] !== undefined ? (
                                String(record[key])
                              ) : (
                                <span className="text-muted">-</span>
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
                          className="px-3 py-2 text-xs text-center text-muted"
                        >
                          {parsedData.length - 100} more rows not shown
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>

                <Button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={processing || validationErrors.length > 0}
                >
                  {validationErrors.length > 0
                    ? 'Fix errors to continue'
                    : 'Continue'}
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="bg-kelp/10 border border-kelp/30 p-4 rounded-lg mb-6">
                <div className="flex">
                  <CheckCircle className="h-5 w-5 shrink-0 text-kelp mr-2 mt-0.5" />
                  <div>
                    <h5 className="text-sm font-medium text-kelp mb-1">
                      Ready to import
                    </h5>
                    <p className="text-sm text-chart-ink tabular-nums">
                      You&apos;re about to upload {parsedData.length} {recordType}{' '}
                      records. This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-foam border border-foam-deep p-4 rounded-lg mb-6">
                <h5 className="text-sm font-semibold text-chart-ink mb-2">
                  Summary
                </h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-chart-ink tabular-nums">
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

              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                  Back
                </Button>

                <Button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={processing}
                >
                  {processing ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" aria-hidden />
                      Importing…
                    </>
                  ) : (
                    `Import ${parsedData.length} records`
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default BulkUploadModal
