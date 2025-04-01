// pages/api/cages/index.js
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
      return getCages(req, res)
    case 'POST':
      return createCage(req, res, session.user.id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get all cages
async function getCages(req, res) {
  try {
    // Optional filter by status
    const { status } = req.query

    let query = supabase.from('cages').select('*')

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query.order('name')

    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error fetching cages:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Create a new cage
async function createCage(req, res, userId) {
  try {
    const cageData = req.body

    // Add metadata
    cageData.created_by = userId
    cageData.created_at = new Date()

    const { data, error } = await supabase.from('cages').insert([cageData])

    if (error) throw error

    return res.status(201).json(data)
  } catch (error) {
    console.error('Error creating cage:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
