// components/Dashboard.js (Complete)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { 
  Calculator, Scale, AlertTriangle, Droplets, Plus, 
  TrendingUp, Calendar, DollarSign, Percent, 
  ArrowUp, ArrowDown, ChevronDown, ChevronUp,
  Thermometer, Water, Wind, Sun
} from 'lucide-react'
import {
  LineChart as RechartsLineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  SparkLine
} from 'recharts'
import {
  cageService,
  stockingService,
  dailyRecordService,
  biweeklyRecordService,
} from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import BiweeklyForm from './BiweeklyForm'
import HarvestForm from './HarvestForm'
import DailyEntryForm from './DailyEntryForm'
import Pagination from './Pagination'
import DataTable from './DataTable'

function Dashboard({ selectedCage }) {
  const router = useRouter()
  const [cages, setCages] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [biweeklyRecords, setBiweeklyRecords] = useState([])
  const [recentStockings, setRecentStockings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [metrics, setMetrics] = useState({
    totalActiveCages: 0,
    totalBiomass: 0,
    averageFCR: 'N/A',
    mortalityRate: '0.0',
    avgDailyGrowth: 'N/A',
    daysToHarvest: 'N/A',
    feedCostPerKg: 'N/A',
    survivalRate: 'N/A',
  })
  const [expandedSections, setExpandedSections] = useState({
    metrics: true,
    charts: true,
    stockings: true
  })
  const [timeRange, setTimeRange] = useState('30d') // '7d', '30d', '90d', '1y'
  const [waterQualityData, setWaterQualityData] = useState([])

  console.log(
    'Dashboard rendered with selectedCage:',
    selectedCage,
  )

  // Fetch data from database
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        console.log('Fetching data for dashboard...')

        // Fetch cages
        const {
          data: cagesData,
          error: cagesError,
        } = await cageService.getAllCages()
        if (cagesError) throw cagesError
        console.log('Fetched cages:', cagesData)
        setCages(cagesData || [])

        // Calculate total active cages
        const activeCages =
          cagesData?.filter((cage) => cage.status === 'active') || []

        // Fetch recent stockings
        const {
          data: stockingsData,
          error: stockingsError,
        } = await stockingService.getAllStockings()
        if (stockingsError) throw stockingsError
        console.log('Fetched stockings:', stockingsData)

        // Sort and get most recent stockings
        const sortedStockings =
          stockingsData?.sort(
            (a, b) => new Date(b.stocking_date) - new Date(a.stocking_date),
          ) || []

        setRecentStockings(sortedStockings)

        await updateDashboardMetrics(cagesData, stockingsData)
      } catch (error) {
        console.error('Error fetching data:', error.message)
        setError(error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Fetch data for specific cage when selected cage changes
  useEffect(() => {
    async function fetchCageSpecificData() {
      if (!selectedCage) return

      try {
        console.log('Fetching data for selected cage:', selectedCage)

        // Fetch daily records
        const {
          data: dailyData,
          error: dailyError,
        } = await dailyRecordService.getDailyRecords(selectedCage)
        if (dailyError) throw dailyError
        setDailyRecords(dailyData || [])

        // Fetch biweekly records
        const {
          data: biweeklyData,
          error: biweeklyError,
        } = await biweeklyRecordService.getBiweeklyRecords(selectedCage)
        if (biweeklyError) throw biweeklyError
        setBiweeklyRecords(biweeklyData || [])
      } catch (error) {
        console.error(
          `Error fetching data for cage ${selectedCage}:`,
          error.message,
        )
      }
    }

    if (selectedCage) {
      fetchCageSpecificData()
    }
  }, [selectedCage])

  // Calculate dashboard metrics from Convex reports + local stocking totals
  const updateDashboardMetrics = async (cages, stockings) => {
    if (!cages || cages.length === 0) return

    const activeCages = cages.filter((cage) => cage.status === 'active')
    const recentStockingsMap = {}
    activeCages.forEach((cage) => {
      const cageStockings = (stockings || [])
        .filter((stocking) => stocking.cage_id === cage.id || stocking.cage_id === cage._id)
        .sort((a, b) => new Date(b.stocking_date) - new Date(a.stocking_date))
      if (cageStockings.length > 0) {
        recentStockingsMap[cage.id || cage._id] = cageStockings[0]
      }
    })

    let totalBiomass = 0
    Object.values(recentStockingsMap).forEach((stocking) => {
      totalBiomass += stocking.initial_biomass || 0
    })

    let averageFCR = 'N/A'
    let mortalityRate = '0.0'
    let reportGrowth = null
    let feedCostPerKg = 'N/A'

    try {
      const client = getConvexHttpClient()
      const kpis = await client.query(api.reports.dashboardKpis, {
        dateRange: 30,
      })

      if (kpis?.mortality_rate_pct != null) {
        mortalityRate = Number(kpis.mortality_rate_pct).toFixed(1)
      }
      if (kpis?.avg_fcr != null) {
        averageFCR = Number(kpis.avg_fcr).toFixed(2)
      }
      if (kpis?.avg_daily_growth_g != null) {
        reportGrowth = kpis.avg_daily_growth_g
      }
      if (kpis?.feed_cost_per_kg_harvested != null) {
        feedCostPerKg = Number(kpis.feed_cost_per_kg_harvested).toFixed(2)
      }
    } catch (err) {
      console.warn('Dashboard KPIs unavailable:', err?.message || err)
    }

    setMetrics({
      totalActiveCages: activeCages.length,
      totalBiomass: Math.round(totalBiomass),
      averageFCR,
      mortalityRate,
      avgDailyGrowth:
        reportGrowth != null
          ? Number(reportGrowth).toFixed(1)
          : calculateAvgDailyGrowth(cages, dailyRecords, biweeklyRecords),
      daysToHarvest: calculateDaysToHarvest(
        cages,
        dailyRecords,
        biweeklyRecords,
      ),
      feedCostPerKg:
        feedCostPerKg !== 'N/A'
          ? feedCostPerKg
          : calculateFeedCostPerKg(cages, dailyRecords, biweeklyRecords),
      survivalRate: calculateSurvivalRate(cages, dailyRecords),
    })
  }

  // Helper function to calculate average daily growth
  const calculateAvgDailyGrowth = (cages, dailyRecords, biweeklyRecords) => {
    if (!biweeklyRecords || biweeklyRecords.length < 2) return 'N/A'

    let totalGrowth = 0
    let count = 0

    // Group records by cage
    const cageRecords = {}
    biweeklyRecords.forEach(record => {
      if (!cageRecords[record.cage_id]) {
        cageRecords[record.cage_id] = []
      }
      cageRecords[record.cage_id].push(record)
    })

    // Calculate growth rate for each cage
    Object.values(cageRecords).forEach(records => {
      if (records.length >= 2) {
        // Sort by date
        records.sort((a, b) => new Date(a.date) - new Date(b.date))
        
        // Calculate growth between first and last record
        const firstRecord = records[0]
        const lastRecord = records[records.length - 1]
        const daysDiff = Math.floor((new Date(lastRecord.date) - new Date(firstRecord.date)) / (1000 * 60 * 60 * 24))
        
        if (daysDiff > 0) {
          const growth = lastRecord.average_body_weight - firstRecord.average_body_weight
          const dailyGrowth = growth / daysDiff
          totalGrowth += dailyGrowth
          count++
        }
      }
    })

    return count > 0 ? (totalGrowth / count).toFixed(1) : 'N/A'
  }

  // Helper function to calculate days to harvest
  const calculateDaysToHarvest = (cages, dailyRecords, biweeklyRecords) => {
    if (!biweeklyRecords || biweeklyRecords.length < 2) return 'N/A'

    const targetWeight = 500 // Target harvest weight in grams
    const avgGrowth = parseFloat(calculateAvgDailyGrowth(cages, dailyRecords, biweeklyRecords))
    
    if (avgGrowth === 'N/A' || avgGrowth <= 0) return 'N/A'

    // Get current average weight
    const currentWeight = biweeklyRecords.reduce((sum, record) => sum + record.average_body_weight, 0) / biweeklyRecords.length
    
    const remainingGrowth = targetWeight - currentWeight
    const daysToHarvest = Math.ceil(remainingGrowth / avgGrowth)

    return daysToHarvest > 0 ? daysToHarvest : 'N/A'
  }

  // Helper function to calculate feed cost per kg
  const calculateFeedCostPerKg = (cages, dailyRecords, biweeklyRecords) => {
    if (!dailyRecords || dailyRecords.length === 0) return 'N/A'

    let totalFeedCost = 0
    let totalFeedAmount = 0

    dailyRecords.forEach(record => {
      if (record.feed_amount && record.feed_price) {
        totalFeedCost += record.feed_amount * record.feed_price
        totalFeedAmount += record.feed_amount
      }
    })

    if (totalFeedAmount === 0) return 'N/A'

    const feedCostPerKg = totalFeedCost / totalFeedAmount
    return feedCostPerKg.toFixed(2)
  }

  // Helper function to calculate survival rate
  const calculateSurvivalRate = (cages, dailyRecords) => {
    if (!cages || cages.length === 0) return 'N/A'

    let totalInitialCount = 0
    let totalMortality = 0

    cages.forEach(cage => {
      if (cage.status === 'active') {
        totalInitialCount += cage.initial_count || 0
        
        // Sum up mortalities from daily records
        const cageMortality = dailyRecords
          .filter(record => record.cage_id === cage.id)
          .reduce((sum, record) => sum + (record.mortality || 0), 0)
        
        totalMortality += cageMortality
      }
    })

    if (totalInitialCount === 0) return 'N/A'

    const survivalRate = ((totalInitialCount - totalMortality) / totalInitialCount) * 100
    return survivalRate.toFixed(1)
  }

  // Process growth data for chart
  const prepareGrowthData = () => {
    if (!biweeklyRecords || biweeklyRecords.length === 0) return []

    // Group data by date and cage
    const groupedByDate = {}
    
    biweeklyRecords.forEach((record) => {
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })

      if (!groupedByDate[date]) {
        groupedByDate[date] = {
          date,
          // Initialize with null values for all cages
          ...cages.reduce((acc, cage) => {
            acc[cage.name] = null
            return acc
          }, {})
        }
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      if (cage) {
        groupedByDate[date][cage.name] = record.average_body_weight
      }
    })

    // Convert to array and sort by date
    return Object.values(groupedByDate).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    )
  }

  // Process feed data for chart
  const prepareFeedData = () => {
    if (!dailyRecords || dailyRecords.length === 0) return []

    // Group by date and cage
    const groupedByDate = {}
    
    dailyRecords.forEach((record) => {
      const date = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      })

      if (!groupedByDate[date]) {
        groupedByDate[date] = {
          date,
          // Initialize with 0 values for all cages
          ...cages.reduce((acc, cage) => {
            acc[cage.name] = 0
            return acc
          }, {})
        }
      }

      // Find cage name
      const cage = cages.find((c) => c.id === record.cage_id)
      if (cage) {
        groupedByDate[date][cage.name] += record.feed_amount || 0
      }
    })

    // Convert to array and sort by date
    return Object.values(groupedByDate).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    )
  }

  // Format date in a user-friendly way (DataTable cells receive the full row)
  const parseDate = (value) => {
    if (value == null || value === '') return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const formatDate = (dateString) => {
    const date = parseDate(dateString)
    if (!date) return '—'
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const daysOfCulture = (dateString) => {
    const stockingDate = parseDate(dateString)
    if (!stockingDate) return null
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const start = new Date(stockingDate)
    start.setHours(0, 0, 0, 0)
    return Math.floor((today - start) / (1000 * 60 * 60 * 24))
  }

  const growthData = prepareGrowthData()
  const feedData = prepareFeedData()

  // Stock table column definitions
  const stockingColumns = [
    {
      header: 'Batch Number',
      accessor: 'batch_number',
      sortable: true,
      searchable: true,
      cell: (row) => (
        <span className="font-medium text-lagoon-800">{row.batch_number}</span>
      ),
    },
    {
      header: 'Cage',
      accessor: 'cage.name',
      sortable: true,
      searchable: true,
    },
    {
      header: 'Stocking Date',
      accessor: 'stocking_date',
      sortable: true,
      cell: (row) => formatDate(row.stocking_date || row.stockingDate),
    },
    {
      header: 'DOC',
      accessor: 'stocking_date',
      cell: (row) => {
        const doc = daysOfCulture(row.stocking_date || row.stockingDate)
        return doc == null ? '—' : `${doc} days`
      },
    },
    {
      header: 'Initial Count',
      accessor: 'fish_count',
      cell: (row) =>
        row.fish_count != null ? Number(row.fish_count).toLocaleString() : 'N/A',
    },
    {
      header: 'Initial ABW (g)',
      accessor: 'initial_abw',
      cell: (row) =>
        row.initial_abw != null ? Number(row.initial_abw).toFixed(1) : 'N/A',
    },
    {
      header: 'Initial Biomass (kg)',
      accessor: 'initial_biomass',
      cell: (row) =>
        row.initial_biomass != null
          ? Number(row.initial_biomass).toFixed(1)
          : 'N/A',
    },
  ]

  const handleViewStocking = (stocking) => {
    router.push(`/stocking/${stocking.id}`)
  }

  // New function to calculate trend
  const calculateTrend = (current, previous) => {
    if (!previous) return { value: 0, direction: 'neutral' }
    const change = ((current - previous) / previous) * 100
    return {
      value: Math.abs(change).toFixed(1),
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral'
    }
  }

  // New function to prepare water quality data
  const prepareWaterQualityData = () => {
    // Generate sample data for now
    const data = []
    const today = new Date()
    for (let i = 0; i < 30; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      data.push({
        date: date.toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
        }),
        temperature: 28 + Math.random() * 2,
        oxygen: 6 + Math.random(),
        ph: 7 + Math.random()
      })
    }
    console.log('Water Quality Data:', data)
    return data
  }

  // New function to prepare mortality data
  const prepareMortalityData = () => {
    if (!dailyRecords || dailyRecords.length === 0) {
      // Generate sample data if no records
      const data = []
      const today = new Date()
      for (let i = 0; i < 30; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        data.push({
          date: date.toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
          }),
          mortality: Math.floor(Math.random() * 10),
          mortalityRate: Math.random() * 2
        })
      }
      console.log('Sample Mortality Data:', data)
      return data
    }
    
    const data = dailyRecords.map(record => ({
      date: new Date(record.date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
      }),
      mortality: record.mortality || 0,
      mortalityRate: ((record.mortality || 0) / (cages.find(c => c.id === record.cage_id)?.initial_count || 1)) * 100
    }))
    console.log('Mortality Data:', data)
    return data
  }

  // New function to prepare feed efficiency data
  const prepareFeedEfficiencyData = () => {
    if (!dailyRecords || !biweeklyRecords || dailyRecords.length === 0) {
      // Generate sample data if no records
      const data = []
      const today = new Date()
      for (let i = 0; i < 30; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        data.push({
          date: date.toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
          }),
          fcr: 1.5 + Math.random() * 0.5,
          feedAmount: 100 + Math.random() * 50,
          weightGain: 50 + Math.random() * 30
        })
      }
      console.log('Sample Feed Efficiency Data:', data)
      return data
    }
    
    const data = biweeklyRecords.map(record => {
      const periodStart = new Date(record.date)
      periodStart.setDate(periodStart.getDate() - 14)
      
      const periodRecords = dailyRecords.filter(dr => 
        new Date(dr.date) >= periodStart && 
        new Date(dr.date) <= new Date(record.date)
      )
      
      const totalFeed = periodRecords.reduce((sum, r) => sum + (r.feed_amount || 0), 0)
      const weightGain = record.average_body_weight - (record.previous_weight || 0)
      
      return {
        date: new Date(record.date).toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
        }),
        fcr: weightGain > 0 ? totalFeed / weightGain : 0,
        feedAmount: totalFeed,
        weightGain: weightGain
      }
    })
    console.log('Feed Efficiency Data:', data)
    return data
  }

  // New function to prepare biomass projection
  const prepareBiomassProjection = () => {
    if (!biweeklyRecords || biweeklyRecords.length < 2) {
      // Generate sample data if no records
      const data = []
      const today = new Date()
      let currentBiomass = 300
      for (let i = 0; i < 30; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() + i)
        currentBiomass += 5 + Math.random() * 3
        data.push({
          date: date.toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
          }),
          projected: currentBiomass,
          target: 500
        })
      }
      console.log('Sample Biomass Projection Data:', data)
      return data
    }
    
    const lastRecord = biweeklyRecords[0]
    const growthRate = calculateAvgDailyGrowth(cages, dailyRecords, biweeklyRecords)
    
    const projection = []
    let currentDate = new Date()
    let currentBiomass = lastRecord.average_body_weight
    
    for (let i = 0; i < 30; i++) {
      currentDate.setDate(currentDate.getDate() + 1)
      currentBiomass += parseFloat(growthRate)
      
      projection.push({
        date: new Date(currentDate).toLocaleDateString('en-US', {
          month: 'short',
          day: '2-digit',
        }),
        projected: currentBiomass,
        target: 500
      })
    }
    console.log('Biomass Projection Data:', projection)
    return projection
  }

  // Initialize data
  const mortalityData = prepareMortalityData()
  const feedEfficiencyData = prepareFeedEfficiencyData()
  const biomassProjection = prepareBiomassProjection()

  // Add function to generate sparkline data
  const generateSparklineData = (value, trend) => {
    const data = []
    const points = 7
    const baseValue = value * 0.8
    const range = value * 0.4
    
    for (let i = 0; i < points; i++) {
      data.push({
        value: baseValue + (Math.random() * range)
      })
    }
    
    // Add the current value
    data.push({ value })
    return data
  }

  // Add color mapping
  const colorMap = {
    blue: '#2563eb',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#ca8a04',
    purple: '#9333ea',
    indigo: '#4f46e5',
    pink: '#db2777',
    teal: '#0d9488'
  }

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex justify-end space-x-2">
        {['7d', '30d', '90d', '1y'].map(range => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-3 py-1 rounded-md text-sm ${
              timeRange === range
                ? 'bg-lagoon-800 text-white'
                : 'bg-foam text-muted hover:bg-gray-200'
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Summary Cards with Trends */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            title: 'Active Cages',
            value: metrics.totalActiveCages || 0,
            icon: Droplets,
            color: 'blue',
            trend: calculateTrend(metrics.totalActiveCages || 0, 5),
            tooltip: 'Number of currently active fish cages',
            unit: 'cages',
            description: 'Total active production units',
            subtext: `${cages.filter(c => c.status === 'active').length} currently stocked`
          },
          {
            title: 'Total Biomass',
            value: metrics.totalBiomass || 0,
            icon: Scale,
            color: 'green',
            trend: calculateTrend(metrics.totalBiomass || 0, 1000),
            tooltip: 'Total biomass of all fish cages',
            unit: 'kg',
            description: 'Current total fish weight',
            subtext: `Target: ${Math.round((metrics.totalBiomass || 0) * 1.2)} kg`
          },
          {
            title: 'Average FCR',
            value: metrics.averageFCR === 'N/A' ? 0 : parseFloat(metrics.averageFCR),
            icon: Calculator,
            color: 'red',
            trend: calculateTrend(metrics.averageFCR === 'N/A' ? 0 : parseFloat(metrics.averageFCR), 1.5),
            tooltip: 'Feed Conversion Ratio - lower is better',
            unit: '',
            description: 'Feed efficiency indicator',
            subtext: 'Target: < 1.5'
          },
          {
            title: 'Mortality Rate',
            value: metrics.mortalityRate === 'N/A' ? 0 : parseFloat(metrics.mortalityRate),
            icon: AlertTriangle,
            color: 'yellow',
            trend: calculateTrend(metrics.mortalityRate === 'N/A' ? 0 : parseFloat(metrics.mortalityRate), 2.5),
            tooltip: 'Percentage of fish that die each day',
            unit: '%',
            description: 'Daily mortality percentage',
            subtext: 'Target: < 2%'
          },
          {
            title: 'Avg. Daily Growth',
            value: metrics.avgDailyGrowth === 'N/A' ? 0 : parseFloat(metrics.avgDailyGrowth),
            icon: TrendingUp,
            color: 'purple',
            trend: calculateTrend(metrics.avgDailyGrowth === 'N/A' ? 0 : parseFloat(metrics.avgDailyGrowth), 1),
            tooltip: 'Average daily weight gain',
            unit: 'g/day',
            description: 'Daily growth rate',
            subtext: 'Target: > 2g/day'
          },
          {
            title: 'Days to Harvest',
            value: metrics.daysToHarvest === 'N/A' ? 0 : parseFloat(metrics.daysToHarvest),
            icon: Calendar,
            color: 'indigo',
            trend: calculateTrend(metrics.daysToHarvest === 'N/A' ? 0 : parseFloat(metrics.daysToHarvest), 10),
            tooltip: 'Time until fish are ready for harvest',
            unit: 'days',
            description: 'Time to target weight',
            subtext: 'Target: 180 days'
          },
          {
            title: 'Feed Cost/kg',
            value: metrics.feedCostPerKg === 'N/A' ? 0 : parseFloat(metrics.feedCostPerKg),
            icon: DollarSign,
            color: 'pink',
            trend: calculateTrend(metrics.feedCostPerKg === 'N/A' ? 0 : parseFloat(metrics.feedCostPerKg), 0.1),
            tooltip: 'Cost of feed per kilogram of fish',
            unit: '₵',
            description: 'Feed cost efficiency',
            subtext: 'Budget: ₵1.50/kg'
          },
          {
            title: 'Survival Rate',
            value: metrics.survivalRate === 'N/A' ? 0 : parseFloat(metrics.survivalRate),
            icon: Percent,
            color: 'teal',
            trend: calculateTrend(metrics.survivalRate === 'N/A' ? 0 : parseFloat(metrics.survivalRate), 50),
            tooltip: 'Percentage of fish that survive',
            unit: '%',
            description: 'Overall survival rate',
            subtext: 'Target: > 95%'
          },
        ].map((metric, index) => {
          const sparklineData = generateSparklineData(
            parseFloat(metric.value) || 0,
            metric.trend
          )
          
          return (
            <div
              key={index}
              className={`bg-${metric.color}-50 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden border border-${metric.color}-100`}
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg bg-${metric.color}-100 mr-3`}>
                      <metric.icon className={`w-5 h-5 text-${metric.color}-600`} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-muted">{metric.title}</h3>
                      <div className="flex items-baseline">
                        <p className="text-2xl font-semibold text-chart-ink">
                          {metric.unit === '₵' ? metric.unit : ''}{metric.value.toFixed(metric.unit === '%' ? 1 : 0)}
                          {metric.unit !== '₵' ? ` ${metric.unit}` : ''}
                        </p>
                        {metric.trend && metric.trend.value > 0 && (
                          <span className={`ml-2 text-sm flex items-center ${
                            metric.trend.direction === 'up' ? 'text-green-600' : 
                            metric.trend.direction === 'down' ? 'text-red-600' : 
                            'text-muted'
                          }`}>
                            {metric.trend.direction === 'up' ? <ArrowUp className="w-3 h-3 mr-1" /> : 
                             metric.trend.direction === 'down' ? <ArrowDown className="w-3 h-3 mr-1" /> : 
                             ''}
                            {metric.trend.value}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Mini sparkline chart */}
                <div className="h-10 mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart data={sparklineData}>
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={colorMap[metric.color]}
                        strokeWidth={2}
                        dot={false}
                      />
                    </RechartsLineChart>
                  </ResponsiveContainer>
                </div>
                
                {/* Description and subtext */}
                <div className="mt-2 pt-2 border-t border-foam-deep">
                  <p className="text-xs text-muted">{metric.subtext}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Charts Section */}
      <div className="page-card p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-medium text-chart-ink">Performance Analytics</h2>
          <button
            onClick={() => setExpandedSections(prev => ({...prev, charts: !prev.charts}))}
            className="text-muted hover:text-chart-ink"
          >
            {expandedSections.charts ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
        
        {expandedSections.charts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Growth Performance Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Growth Performance</h3>
              <div className="h-64">
                {loading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lagoon-800"></div>
                  </div>
                ) : growthData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsLineChart
                      data={growthData}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        label={{ 
                          value: 'Weight (g)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { textAnchor: 'middle' }
                        }}
                      />
                      <Tooltip 
                        formatter={(value) => [`${value} g`, 'Weight']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Legend />
                      {cages.filter(cage => cage.status === 'active').map((cage, index) => {
                        const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']
                        return (
                          <Line
                            key={cage.id}
                            type="monotone"
                            dataKey={cage.name}
                            stroke={colors[index % colors.length]}
                            strokeWidth={2}
                            dot={{ r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        )
                      })}
                    </RechartsLineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted">
                    No growth data available
                  </div>
                )}
              </div>
            </div>

            {/* Feed Consumption Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Feed Consumption</h3>
              <div className="h-64">
                {loading ? (
                  <div className="h-full flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-lagoon-800"></div>
                  </div>
                ) : feedData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart
                      data={feedData}
                      margin={{
                        top: 5,
                        right: 30,
                        left: 20,
                        bottom: 5,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        label={{ 
                          value: 'Feed Amount (kg)', 
                          angle: -90, 
                          position: 'insideLeft',
                          style: { textAnchor: 'middle' }
                        }}
                      />
                      <Tooltip 
                        formatter={(value) => [`${value} kg`, 'Feed Amount']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Legend />
                      {cages.filter(cage => cage.status === 'active').map((cage, index) => {
                        const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6']
                        return (
                          <Bar
                            key={cage.id}
                            dataKey={cage.name}
                            fill={colors[index % colors.length]}
                            stackId="feed"
                          />
                        )
                      })}
                    </RechartsBarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted">
                    No feed data available
                  </div>
                )}
              </div>
            </div>

            {/* Mortality Trend Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Mortality Trend</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mortalityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                    <Tooltip />
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="mortality"
                      stroke="#8884d8"
                      fill="#8884d8"
                      fillOpacity={0.3}
                    />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="mortalityRate"
                      stroke="#82ca9d"
                      fill="#82ca9d"
                      fillOpacity={0.3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Feed Efficiency Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Feed Efficiency (FCR)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={feedEfficiencyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="fcr"
                      stroke="#8884d8"
                      strokeWidth={2}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Biomass Projection Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Biomass Projection</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={biomassProjection}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="projected"
                      stroke="#8884d8"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="target"
                      stroke="#82ca9d"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Water Quality Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Water Quality Parameters</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={waterQualityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                    <Tooltip />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="temperature"
                      stroke="#8884d8"
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="oxygen"
                      stroke="#82ca9d"
                      strokeWidth={2}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Stockings Section */}
      <div className="page-card overflow-hidden">
        <div className="px-6 py-4 border-b border-foam-deep flex justify-between items-center">
          <h2 className="font-medium text-chart-ink">Recent Stockings</h2>
          <div className="flex items-center space-x-4">
            <Link href="/stocking-management">
              <button className="text-sm text-lagoon-800 hover:text-lagoon-950">
                View All Stockings
              </button>
            </Link>
            <button
              onClick={() => setExpandedSections(prev => ({...prev, stockings: !prev.stockings}))}
              className="text-muted hover:text-chart-ink"
            >
              {expandedSections.stockings ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {expandedSections.stockings && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-foam-deep">
              <thead className="bg-foam-deep/40">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Cage
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Stocking Date
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    DOC
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Initial Count
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Initial ABW (g)
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                  >
                    Initial Biomass (kg)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-foam-deep">
                {(recentStockings.length > 0
                  ? recentStockings.slice(0, 10)
                  : cages.filter((c) => c.stocking_date || c.stockingDate)
                ).map((row) => {
                  const stockingDateValue =
                    row.stocking_date || row.stockingDate
                  const doc = daysOfCulture(stockingDateValue)
                  const cageName =
                    row.cage?.name ||
                    row.cage_name ||
                    cages.find((c) => c.id === (row.cage_id || row.cageId))
                      ?.name ||
                    row.name ||
                    '—'
                  const count =
                    row.fish_count ?? row.initial_count ?? row.initialCount
                  const abw = row.initial_abw ?? row.initialAbw
                  const biomass = row.initial_biomass ?? row.initialBiomass

                  return (
                    <tr key={row.id || row._id || `${cageName}-${stockingDateValue}`}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-chart-ink">
                        {cageName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {formatDate(stockingDateValue)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {doc == null ? '—' : `${doc} days`}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {count != null ? Number(count).toLocaleString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {abw != null ? Number(abw).toFixed(1) : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {biomass != null ? Number(biomass).toFixed(1) : 'N/A'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-4">
        <Link href="/create-cage">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-lagoon-800 hover:bg-lagoon-950">
            <Plus className="w-4 h-4 mr-2" />
            New Cage
          </button>
        </Link>

        <Link href="/stocking">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700">
            <Plus className="w-4 h-4 mr-2" />
            New Stocking
          </button>
        </Link>

        <Link href="/biweekly-records">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-lagoon-800 hover:bg-lagoon-950">
            <Scale className="w-4 h-4 mr-2" />
            View Bi-weekly Records
          </button>
        </Link>

        <Link href="/feed-types">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700">
            <Plus className="w-4 h-4 mr-2" />
            Manage Feed Types
          </button>
        </Link>

        <Link href="/feed-suppliers">
          <button className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-2" />
            Manage Feed Suppliers
          </button>
        </Link>
      </div>
    </div>
  )
}

export default Dashboard