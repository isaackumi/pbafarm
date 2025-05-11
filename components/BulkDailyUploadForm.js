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
          // .in('status', ['active'])
          .order('name')

        if (cageError) throw cageError
        setCages(cageData || [])

        const {
          data: feedTypesData,
          error: feedTypesError,
        } = await feedTypeService.getActiveFeedTypes()

        if (feedTypesError) throw feedTypesError
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
      const processedData = await Promise.all(
        parsedData.map(async (row) => {
          const cage = cages.find(
            (c) => c.name.toLowerCase() === row.cage_name.toLowerCase(),
          )
          if (!cage) {
            throw new Error(`Cage not found: ${row.cage_name}`)
          }

          const feedType = feedTypes.find(
            (ft) => ft.name.toLowerCase() === row.feed_type.toLowerCase(),
          )
          if (!feedType) {
            throw new Error(`Feed type not found: ${row.feed_type}`)
          }

          const feedAmount = parseFloat(row.feed_amount)
          const feedPrice = row.feed_price
            ? parseFloat(row.feed_price)
            : feedType.price_per_kg
          const feedCost = feedAmount * feedPrice

          // Handle different date formats
          let parsedDate
          if (row.date instanceof Date) {
            parsedDate = row.date.toISOString().split('T')[0]
          } else if (!isNaN(row.date)) {
            parsedDate = excelSerialDateToJSDate(parseFloat(row.date))
          } else {
            parsedDate = new Date(row.date).toISOString().split('T')[0]
          }

          return {
            cage_id: cage.id,
            date: parsedDate,
            feed_amount: feedAmount,
            feed_type_id: feedType.id,
            feed_price: feedPrice,
            feed_cost: feedCost,
            mortality: row.mortality ? parseInt(row.mortality) : 0,
            notes: row.notes || null,
            created_at: new Date(),
          }
        }),
      )

      const { data, error } = await supabase
        .from('daily_records')
        .insert(processedData)

      if (error) throw error

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
                <strong>cage_name</strong>: Exact name of the cage (must exist
                in the system)
              </li>
              <li>
                <strong>date</strong>: Date of the record (YYYY-MM-DD format)
              </li>
              <li>
                <strong>feed_amount</strong>: Amount of feed in kg
              </li>
              <li>
                <strong>feed_type</strong>: Exact name of the feed type (must
                exist in the system)
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
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <CloudUpload className="h-5 w-5 mr-2" />
            Upload Daily Records
          </button>
        </div>

        <BulkUploadModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onUpload={handleUpload}
          recordType="daily_records"
          templateHeaders={templateHeaders}
          validationRules={validationRules}
          maxRows={500}
        />
      </div>
    </div>
  )
}

export default BulkDailyUploadForm
