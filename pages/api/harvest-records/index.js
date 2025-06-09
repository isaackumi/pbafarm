// pages/api/harvest-records/index.js
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
      return getHarvestRecord(req, res)
    case 'POST':
      return createHarvestRecord(req, res, session.user.id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get harvest record for a specific cage
async function getHarvestRecord(req, res) {
  try {
    const { cage_id } = req.query

    if (!cage_id) {
      return res.status(400).json({ error: 'Cage ID is required' })
    }

    const { data, error } = await supabase
      .from('harvest_records')
      .select('*')
      .eq('cage_id', cage_id)
      .maybeSingle() // Returns null instead of error if no record found

    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error fetching harvest record:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Create a new harvest record
async function createHarvestRecord(req, res, userId) {
  try {
    const recordData = req.body

    // Check for required fields
    if (
      !recordData.cage_id ||
      !recordData.harvest_date ||
      !recordData.total_weight ||
      !recordData.average_body_weight ||
      !recordData.estimated_count ||
      !recordData.fcr
    ) {
      return res.status(400).json({ 
        error: 'Missing required fields. Please provide: cage_id, harvest_date, total_weight, average_body_weight, estimated_count, and fcr' 
      })
    }

    // Check if cage already has a harvest record
    const { data: existingRecord, error: checkError } = await supabase
      .from('harvest_records')
      .select('id')
      .eq('cage_id', recordData.cage_id)
      .maybeSingle()

    if (checkError) throw checkError

    if (existingRecord) {
      return res
        .status(400)
        .json({ error: 'Cage already has a harvest record' })
    }

    // Add metadata
    recordData.created_by = userId
    recordData.created_at = new Date()

    // Create harvest record
    const { data, error } = await supabase
      .from('harvest_records')
      .insert([recordData])
      .select()

    if (error) throw error

    // Update cage status to 'harvested'
    const { error: updateError } = await supabase
      .from('cages')
      .update({ status: 'harvested', updated_at: new Date() })
      .match({ id: recordData.cage_id })

    if (updateError) throw updateError

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error creating harvest record:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
