// pages/api/daily-records/index.js
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
      return getDailyRecords(req, res)
    case 'POST':
      return createDailyRecord(req, res, session.user.id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get daily records for a specific cage
async function getDailyRecords(req, res) {
  try {
    const { cage_id, limit = 100 } = req.query

    if (!cage_id) {
      return res.status(400).json({ error: 'Cage ID is required' })
    }

    const { data, error } = await supabase
      .from('daily_records')
      .select('*')
      .eq('cage_id', cage_id)
      .order('date', { ascending: false })
      .limit(parseInt(limit))

    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error fetching daily records:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Create a new daily record
async function createDailyRecord(req, res, userId) {
  try {
    const recordData = req.body

    // Check for required fields
    if (
      !recordData.cage_id ||
      !recordData.date ||
      recordData.feed_amount === undefined
    ) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Calculate feed cost if not provided
    if (
      recordData.feed_amount &&
      recordData.feed_price &&
      !recordData.feed_cost
    ) {
      recordData.feed_cost =
        parseFloat(recordData.feed_amount) * parseFloat(recordData.feed_price)
    }

    // Add metadata
    recordData.created_by = userId
    recordData.created_at = new Date()

    const { data, error } = await supabase
      .from('daily_records')
      .insert([recordData])

    if (error) throw error

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error creating daily record:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
