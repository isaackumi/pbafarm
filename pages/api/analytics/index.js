// pages/api/analytics/index.js
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
      return getAnalytics(req, res)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }
}

// Get analytics data
async function getAnalytics(req, res) {
  try {
    const { type } = req.query

    switch (type) {
      case 'summary':
        return getCageSummary(req, res)
      case 'growth':
        return getGrowthData(req, res)
      case 'feed':
        return getFeedData(req, res)
      case 'biomass':
        return getBiomassData(req, res)
      default:
        return res.status(400).json({ error: 'Invalid analytics type' })
    }
  } catch (error) {
    console.error('Error fetching analytics:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Get summary statistics for all cages
async function getCageSummary(req, res) {
  try {
    // Get all cages
    const { data: cages, error: cagesError } = await supabase
      .from('cages')
      .select('*')

    if (cagesError) throw cagesError

    // Calculate summary statistics
    const totalCages = cages.length
    const activeCages = cages.filter((cage) => cage.status === 'active').length
    const harvestedCages = cages.filter((cage) => cage.status === 'harvested')
      .length
    const maintenanceCages = cages.filter(
      (cage) => cage.status === 'maintenance',
    ).length
    const fallowCages = cages.filter((cage) => cage.status === 'fallow').length

    // Get total feed used
    const { data: feedData, error: feedError } = await supabase
      .from('daily_records')
      .select('feed_amount, feed_cost')

    if (feedError) throw feedError

    const totalFeed = feedData.reduce(
      (sum, record) => sum + (record.feed_amount || 0),
      0,
    )
    const totalFeedCost = feedData.reduce(
      (sum, record) => sum + (record.feed_cost || 0),
      0,
    )

    // Get total mortality
    const { data: mortalityData, error: mortalityError } = await supabase
      .from('daily_records')
      .select('mortality')

    if (mortalityError) throw mortalityError

    const totalMortality = mortalityData.reduce(
      (sum, record) => sum + (record.mortality || 0),
      0,
    )

    // Calculate total initial stocking
    const totalInitialCount = cages.reduce(
      (sum, cage) => sum + (cage.initial_count || 0),
      0,
    )

    // Calculate mortality rate
    const mortalityRate =
      totalInitialCount > 0
        ? ((totalMortality / totalInitialCount) * 100).toFixed(1)
        : 0

    return res.status(200).json({
      totalCages,
      activeCages,
      harvestedCages,
      maintenanceCages,
      fallowCages,
      totalFeed: totalFeed.toFixed(1),
      totalFeedCost: totalFeedCost.toFixed(2),
      totalMortality,
      mortalityRate,
    })
  } catch (error) {
    console.error('Error calculating summary:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Get growth data for all cages or a specific cage
async function getGrowthData(req, res) {
  try {
    const { cage_id } = req.query

    let query = supabase
      .from('biweekly_records')
      .select(
        `
        id,
        date,
        average_body_weight,
        cage_id,
        cages (name)
      `,
      )
      .order('date')

    if (cage_id) {
      query = query.eq('cage_id', cage_id)
    }

    const { data, error } = await query

    if (error) throw error

    // Process data for charting
    const processedData = data.map((record) => ({
      id: record.id,
      date: record.date,
      abw: record.average_body_weight,
      cageId: record.cage_id,
      cageName: record.cages?.name,
    }))

    return res.status(200).json(processedData)
  } catch (error) {
    console.error('Error fetching growth data:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Get feed consumption data
async function getFeedData(req, res) {
  try {
    const { cage_id, period = 'weekly' } = req.query

    let query = supabase
      .from('daily_records')
      .select(
        `
        id,
        date,
        feed_amount,
        feed_cost,
        cage_id,
        cages (name)
      `,
      )
      .order('date')

    if (cage_id) {
      query = query.eq('cage_id', cage_id)
    }

    const { data, error } = await query

    if (error) throw error

    // Process data for charting based on period
    let groupedData = {}

    data.forEach((record) => {
      let key
      const date = new Date(record.date)

      if (period === 'daily') {
        key = record.date
      } else if (period === 'weekly') {
        // Group by week number within the year
        const weekNumber = Math.ceil(
          (date.getDate() +
            new Date(date.getFullYear(), date.getMonth(), 1).getDay()) /
            7,
        )
        key = `${date.getFullYear()}-W${weekNumber}`
      } else if (period === 'monthly') {
        key = `${date.getFullYear()}-${date.getMonth() + 1}`
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          period: key,
          totalFeed: 0,
          totalCost: 0,
          cages: {},
        }
      }

      groupedData[key].totalFeed += record.feed_amount || 0
      groupedData[key].totalCost += record.feed_cost || 0

      // Track per-cage data
      const cageName = record.cages?.name || record.cage_id
      if (!groupedData[key].cages[cageName]) {
        groupedData[key].cages[cageName] = {
          feed: 0,
          cost: 0,
        }
      }
      groupedData[key].cages[cageName].feed += record.feed_amount || 0
      groupedData[key].cages[cageName].cost += record.feed_cost || 0
    })

    // Convert to array and sort
    const result = Object.values(groupedData).sort((a, b) =>
      a.period.localeCompare(b.period),
    )

    return res.status(200).json(result)
  } catch (error) {
    console.error('Error fetching feed data:', error.message)
    return res.status(500).json({ error: error.message })
  }
}

// Get estimated biomass data
async function getBiomassData(req, res) {
  try {
    // Get all active cages
    const { data: cages, error: cagesError } = await supabase
      .from('cages')
      .select('*')
      .eq('status', 'active')

    if (cagesError) throw cagesError

    // Calculate biomass for each cage
    const biomassData = []

    for (const cage of cages) {
      // Get latest ABW record
      const { data: latestABW, error: abwError } = await supabase
        .from('biweekly_records')
        .select('*')
        .eq('cage_id', cage.id)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (abwError) throw abwError

      // Get total mortality
      const {
        data: mortalityData,
        error: mortalityError,
      } = await supabase
        .from('daily_records')
        .select('mortality')
        .eq('cage_id', cage.id)

      if (mortalityError) throw mortalityError

      const totalMortality = mortalityData.reduce(
        (sum, record) => sum + (record.mortality || 0),
        0,
      )

      // Calculate estimated survival
      const estimatedCount = cage.initial_count - totalMortality

      // Calculate current biomass (if we have ABW data)
      let currentBiomass = null
      let abw = null

      if (latestABW) {
        abw = latestABW.average_body_weight
        currentBiomass = (abw * estimatedCount) / 1000 // Convert grams to kg
      }

      biomassData.push({
        cageId: cage.id,
        cageName: cage.name,
        initialCount: cage.initial_count,
        currentCount: estimatedCount,
        initialWeight: cage.initial_weight,
        initialABW: cage.initial_abw,
        currentABW: abw,
        currentBiomass: currentBiomass,
        survivalRate: ((estimatedCount / cage.initial_count) * 100).toFixed(1),
      })
    }

    return res.status(200).json(biomassData)
  } catch (error) {
    console.error('Error calculating biomass data:', error.message)
    return res.status(500).json({ error: error.message })
  }
}
