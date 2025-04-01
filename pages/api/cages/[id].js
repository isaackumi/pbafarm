// pages/api/cages/[id].js
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

  const { id } = req.query

  switch (req.method) {
    case 'GET':
      return getCage(req, res, id)
    case 'PATCH':
      return updateCage(req, res, id)
    case 'DELETE':
      return deleteCage(req, res, id)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get a specific cage
async function getCage(req, res, id) {
  try {
    const { data, error } = await supabase
      .from('cages')
      .select('*')
      .eq('id', id)
      .single()

    if (error) throw error

    if (!data) {
      return res.status(404).json({ error: 'Cage not found' })
    }

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error fetching cage:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Update a cage
async function updateCage(req, res, id) {
  try {
    const updateData = req.body

    // Add updated timestamp
    updateData.updated_at = new Date()

    const { data, error } = await supabase
      .from('cages')
      .update(updateData)
      .match({ id })

    if (error) throw error

    return res.status(200).json(data)
  } catch (error) {
    console.error('Error updating cage:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Delete a cage
async function deleteCage(req, res, id) {
  try {
    // Check if cage has associated records
    const { data: hasRecords, error: checkError } = await supabase
      .from('daily_records')
      .select('id')
      .eq('cage_id', id)
      .limit(1)

    if (checkError) throw checkError

    if (hasRecords && hasRecords.length > 0) {
      return res.status(400).json({
        error:
          'Cannot delete cage with existing records. Consider changing its status instead.',
      })
    }

    const { data, error } = await supabase.from('cages').delete().match({ id })

    if (error) throw error

    return res.status(200).json({ message: 'Cage deleted successfully' })
  } catch (error) {
    console.error('Error deleting cage:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
