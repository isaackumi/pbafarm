// pages/api/biweekly-records/index.js
import { supabase } from '../../../lib/supabase'

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
      return createBiweeklyRecord(req, res, session.user.id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get biweekly records for a specific cage
async function getBiweeklyRecords(req, res) {
  try {
    const { cage_id } = req.query

    if (!cage_id) {
      return res.status(400).json({ error: 'Cage ID is required' })
    }

    const { data, error } = await supabase
      .from('biweekly_records')
      .select('*')
      .eq('cage_id', cage_id)
      .order('date', { ascending: false })

    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error fetching biweekly records:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Create a new biweekly record
async function createBiweeklyRecord(req, res, userId) {
  try {
    const recordData = req.body

    // Check for required fields
    if (
      !recordData.cage_id ||
      !recordData.date ||
      recordData.average_body_weight === undefined
    ) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Add metadata
    recordData.created_by = userId
    recordData.created_at = new Date()

    const { data, error } = await supabase
      .from('biweekly_records')
      .insert([recordData])

    if (error) throw error

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error creating biweekly record:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
