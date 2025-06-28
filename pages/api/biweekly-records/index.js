// pages/api/biweekly-records/index.js
import { supabase } from '../../../lib/supabase'
import { biweeklyRecordService } from '../../../lib/databaseService'

export default async function handler(req, res) {
  // Check if user is authenticated
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession()

  if (authError || !session) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  switch (req.method) {
    case 'GET':
      return getBiweeklyRecords(req, res)
    case 'POST':
      return createBiweeklyRecord(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get biweekly records
async function getBiweeklyRecords(req, res) {
  try {
    const { cage_id, page = 1, page_size = 20 } = req.query

    if (cage_id) {
      // Get records for specific cage
      const { data, error } = await biweeklyRecordService.getBiweeklyRecords(cage_id)
      
      if (error) {
        console.error('Error fetching biweekly records:', error)
        return res.status(500).json({ error: 'Failed to fetch biweekly records' })
      }

      return res.status(200).json(data)
    } else {
      // Get all records with pagination
      const { data, error, totalCount, totalPages, currentPage } = await biweeklyRecordService.getBiweeklyRecordsPaginated(
        parseInt(page),
        parseInt(page_size)
      )
      
      if (error) {
        console.error('Error fetching biweekly records:', error)
        return res.status(500).json({ error: 'Failed to fetch biweekly records' })
      }

      return res.status(200).json({
        data,
        pagination: {
          totalCount,
          totalPages,
          currentPage,
          pageSize: parseInt(page_size)
        }
      })
    }
  } catch (error) {
    console.error('Error in getBiweeklyRecords:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Create a new biweekly record
async function createBiweeklyRecord(req, res) {
  try {
    const recordData = req.body

    // Check for required fields
    if (
      !recordData.cage_id ||
      !recordData.date ||
      recordData.average_body_weight === undefined ||
      !recordData.total_fish_count ||
      !recordData.total_weight
    ) {
      return res.status(400).json({ 
        error: 'Missing required fields: cage_id, date, average_body_weight, total_fish_count, total_weight' 
      })
    }

    // Generate batch code if not provided
    if (!recordData.batch_code) {
      const timestamp = new Date().getTime()
      recordData.batch_code = `BW${timestamp}`
    }

    const { data, error } = await biweeklyRecordService.createBiweeklyRecord(recordData)

    if (error) {
      console.error('Error creating biweekly record:', error)
      return res.status(500).json({ error: 'Failed to create biweekly record' })
    }

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error in createBiweeklyRecord:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
