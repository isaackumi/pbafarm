// components/BulkDailyUploadForm.js
import React, { useState, useEffect } from 'react'
import { CloudUpload, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import BulkUploadModal from './BulkUploadModal'
import { useToast } from '../hooks/useToast'
import feedTypeService from '../lib/feedTypeService'

// Excel serial number to YYYY-MM-DD string
const excelSerialDateToJSDate = (serial) => {
  const utc_days = Math.floor(serial - 25569)
  const utc_value = utc_days * 86400
  const date_info = new Date(utc_value * 1000)

  const fractional_day = serial - Math.floor(serial) + 0.0000001
  const total_seconds = Math.floor(86400 * fractional_day)

  const seconds = total_seconds % 60
  const minutes = Math.floor(total_seconds / 60) % 60
  const hours = Math.floor(total_seconds / 3600)

  date_info.setHours(hours)
  date_info.setMinutes(minutes)
  date_info.setSeconds(seconds)

  return date_info.toISOString().split('T')[0]
}

const BulkDailyUploadForm = () => {
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { showToast } = useToast()

  const templateHeaders = [
    'cage_name',
    'date',
    'feed_amount',
    'feed_type',
    'feed_price',
    'mortality',
    'notes',
  ]

  const validationRules = {
    cage_name: { required: true },
    date: { required: true, type: 'date' },
    feed_amount: { required: true, type: 'number', min: 0 },
    feed_type: { required: true },
    feed_price: { required: false, type: 'number', min: 0 },
    mortality: { required: false, type: 'number', min: 0 },
    notes: { required: false },
  }

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const { data: cageData, error: cageError } = await supabase
          .from('cage_info')
          .select('id, name, status')
          .order('name')

        if (cageError) throw cageError
        console.log('Fetched existing cages:', cageData)
        setCages(cageData || [])

        const {
          data: feedTypesData,
          error: feedTypesError,
        } = await feedTypeService.getActiveFeedTypes()

        if (feedTypesError) throw feedTypesError
        console.log('Fetched feed types:', feedTypesData)
        setFeedTypes(feedTypesData || [])
      } catch (error) {
        console.error('Error fetching data:', error)
        setError('Failed to load required data. Please try again.')
        showToast('error', 'Failed to load required data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleUpload = async (parsedData) => {
    try {
      console.log('Processing upload data:', parsedData)

      // Process each row in the uploaded file
      const processedData = await Promise.all(
        parsedData.map(async (row, rowIndex) => {
          // Normalize cage name (trim and lowercase for comparison)
          const cageNameNormalized = row.cage_name.trim().toLowerCase()

          // Find matching cage (case-insensitive)
          const cage = cages.find(
            (c) => c.name.toLowerCase().trim() === cageNameNormalized,
          )

          if (!cage) {
            throw new Error(
              `Row ${rowIndex + 2}: Cage not found: "${
                row.cage_name
              }". Please check the cage name matches exactly with an existing cage.`,
            )
          }

          // Normalize feed type name (trim and lowercase for comparison)
          const feedTypeNormalized = row.feed_type.trim().toLowerCase()

          // Find matching feed type (case-insensitive)
          const feedType = feedTypes.find(
            (ft) => ft.name.toLowerCase().trim() === feedTypeNormalized,
          )

          if (!feedType) {
            throw new Error(
              `Row ${rowIndex + 2}: Feed type not found: "${
                row.feed_type
              }". Please check the feed type matches exactly with an existing feed type.`,
            )
          }

          // Parse feed amount with validation
          const feedAmount = parseFloat(row.feed_amount)
          if (isNaN(feedAmount) || feedAmount < 0) {
            throw new Error(
              `Row ${rowIndex + 2}: Invalid feed amount: "${
                row.feed_amount
              }". Must be a positive number.`,
            )
          }

          // Handle feed price (use feed type price if not provided)
          const feedPrice = row.feed_price
            ? parseFloat(row.feed_price)
            : feedType.price_per_kg

          if (isNaN(feedPrice) || feedPrice < 0) {
            throw new Error(
              `Row ${rowIndex + 2}: Invalid feed price: "${
                row.feed_price
              }". Must be a positive number.`,
            )
          }

          // Calculate feed cost
          const feedCost = feedAmount * feedPrice

          // Handle mortality (default to 0 if not provided)
          const mortality = row.mortality ? parseInt(row.mortality) : 0
          if (isNaN(mortality) || mortality < 0) {
            throw new Error(
              `Row ${rowIndex + 2}: Invalid mortality: "${
                row.mortality
              }". Must be a non-negative number.`,
            )
          }

          // Parse date with flexible format handling
          let parsedDate
          if (row.date instanceof Date) {
            parsedDate = row.date.toISOString().split('T')[0]
          } else if (!isNaN(row.date)) {
            // Handle Excel date format (numeric value)
            parsedDate = excelSerialDateToJSDate(parseFloat(row.date))
          } else {
            try {
              parsedDate = new Date(row.date).toISOString().split('T')[0]
              // Validate if date is valid
              if (parsedDate === 'Invalid Date' || !parsedDate) {
                throw new Error(
                  `Row ${rowIndex + 2}: Invalid date format: "${
                    row.date
                  }". Please use YYYY-MM-DD format.`,
                )
              }
            } catch (error) {
              throw new Error(
                `Row ${rowIndex + 2}: Invalid date format: "${
                  row.date
                }". Please use YYYY-MM-DD format.`,
              )
            }
          }

          // Return properly formatted record for database insertion
          return {
            cage_id: cage.id,
            date: parsedDate,
            feed_amount: feedAmount,
            feed_type_id: feedType.id,
            feed_price: feedPrice,
            feed_cost: feedCost,
            mortality: mortality,
            notes: row.notes || null,
            created_at: new Date().toISOString(),
          }
        }),
      )

      console.log('Processed data ready for upload:', processedData)

      // Insert the processed data into the database
      const { data, error } = await supabase
        .from('daily_records')
        .insert(processedData)

      if (error) {
        console.error('Database error during upload:', error)
        throw error
      }

      setMessage(`Successfully uploaded ${processedData.length} records`)
      showToast(
        'success',
        `Successfully uploaded ${processedData.length} records`,
      )
      return { success: true }
    } catch (error) {
      console.error('Error processing upload:', error)
      showToast('error', `Upload failed: ${error.message}`)
      throw error
    }
  }

  // Function to generate template with valid examples
  const generateTemplateData = () => {
    // Create template headers
    const headers = templateHeaders
    const exampleData = []

    // Add sample data with valid cage names and feed types if available
    if (cages.length > 0 && feedTypes.length > 0) {
      exampleData.push([
        cages[0].name, // Use actual cage name from database
        new Date().toISOString().split('T')[0], // Today's date
        '1.5', // Example feed amount
        feedTypes[0].name, // Use actual feed type from database
        feedTypes[0].price_per_kg.toString(), // Use actual price from database
        '0', // Example mortality
        'Sample record', // Example notes
      ])
    }

    return { headers, exampleData }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">Bulk Daily Records Upload</h2>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 text-red-800 p-4 rounded-md">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-6 bg-green-50 text-green-800 p-4 rounded-md">
            {message}
          </div>
        )}

        <div className="text-gray-600 mb-6">
          <p>
            Upload multiple daily records at once using an Excel or CSV file.
            The file should follow the template format with the following
            columns:
          </p>
          <div className="mt-4 bg-blue-50 p-4 rounded-md">
            <h3 className="text-blue-800 font-medium flex items-center">
              <Info className="h-5 w-5 mr-2" /> Required Columns
            </h3>
            <ul className="mt-2 list-disc list-inside text-blue-800">
              <li>
                <strong>cage_name</strong>:{' '}
                <span className="text-red-600">Must match exactly</span> an
                existing cage name in the system
              </li>
              <li>
                <strong>date</strong>: Date of the record (YYYY-MM-DD format)
              </li>
              <li>
                <strong>feed_amount</strong>: Amount of feed in kg
              </li>
              <li>
                <strong>feed_type</strong>:{' '}
                <span className="text-red-600">Must match exactly</span> an
                existing feed type in the system
              </li>
            </ul>
            <h3 className="mt-4 text-blue-800 font-medium">Optional Columns</h3>
            <ul className="mt-2 list-disc list-inside text-blue-800">
              <li>
                <strong>feed_price</strong>: Price per kg (defaults to the feed
                type's price if not provided)
              </li>
              <li>
                <strong>mortality</strong>: Number of mortalities (defaults to
                0)
              </li>
              <li>
                <strong>notes</strong>: Any additional notes
              </li>
            </ul>
          </div>

          {/* Display available cages and feed types for reference */}
          <div className="mt-4 bg-gray-50 p-4 rounded-md">
            <h3 className="text-gray-700 font-medium">
              Available Cages in System:
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {cages.map((cage) => (
                <span
                  key={cage.id}
                  className="bg-gray-200 px-2 py-1 rounded text-sm text-gray-700"
                >
                  {cage.name}
                </span>
              ))}
              {cages.length === 0 && (
                <span className="text-gray-500 text-sm">No cages found</span>
              )}
            </div>

            <h3 className="mt-4 text-gray-700 font-medium">
              Available Feed Types in System:
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {feedTypes.map((feedType) => (
                <span
                  key={feedType.id}
                  className="bg-gray-200 px-2 py-1 rounded text-sm text-gray-700"
                >
                  {feedType.name}
                </span>
              ))}
              {feedTypes.length === 0 && (
                <span className="text-gray-500 text-sm">
                  No feed types found
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            disabled={loading}
            className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
              loading
                ? 'bg-indigo-400 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700'
            } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
          >
            <CloudUpload className="h-5 w-5 mr-2" />
            Upload Daily Records
          </button>
        </div>

        {/* Pass the template generation function to BulkUploadModal */}
        <BulkUploadModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onUpload={handleUpload}
          recordType="daily_records"
          templateHeaders={templateHeaders}
          validationRules={validationRules}
          maxRows={500}
          templateData={generateTemplateData()}
          cages={cages}
          feedTypes={feedTypes}
        />
      </div>
    </div>
  )
}

export default BulkDailyUploadForm
