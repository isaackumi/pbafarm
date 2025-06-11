import React, { createContext, useContext, useState, useCallback } from 'react'
import { cageService, stockingService, dailyRecordService, biweeklyRecordService } from '../lib/databaseService'

const DataContext = createContext()

export function DataProvider({ children }) {
  const [cages, setCages] = useState([])
  const [stockings, setStockings] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [biweeklyRecords, setBiweeklyRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refreshCages = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await cageService.getAllCages()
      if (error) throw error
      setCages(data)
      return data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshStockings = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await stockingService.getAllStockings()
      if (error) throw error
      setStockings(data)
      return data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshDailyRecords = useCallback(async (cageId) => {
    setLoading(true)
    try {
      const { data, error } = await dailyRecordService.getDailyRecords(cageId)
      if (error) throw error
      setDailyRecords(data)
      return data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshBiweeklyRecords = useCallback(async (cageId) => {
    setLoading(true)
    try {
      const { data, error } = await biweeklyRecordService.getBiweeklyRecords(cageId)
      if (error) throw error
      setBiweeklyRecords(data)
      return data
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        refreshCages(),
        refreshStockings()
      ])
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setLoading(false)
    }
  }, [refreshCages, refreshStockings])

  const value = {
    cages,
    stockings,
    dailyRecords,
    biweeklyRecords,
    loading,
    error,
    refreshCages,
    refreshStockings,
    refreshDailyRecords,
    refreshBiweeklyRecords,
    refreshAll
  }

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  )
}

export const useData = () => {
  const context = useContext(DataContext)
  if (!context) {
    throw new Error('useData must be used within a DataProvider')
  }
  return context
} 