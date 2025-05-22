// components/Header.js (Updated)
import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const Header = ({
  title,
  activeTab,
  selectedCage,
  setSelectedCage,
  cages: propCages,
  showCageSelector = false,
}) => {
  const [cages, setCages] = useState([])
  const [loading, setLoading] = useState(false)

  // Fetch cages directly from database if not provided as props
  useEffect(() => {
    async function fetchCages() {
      // If cages are provided via props, use them
      if (propCages && propCages.length > 0) {
        setCages(propCages)
        return
      }

      setLoading(true)
      try {
        // Fetch active cages for data entry
        const { data, error } = await supabase
          .from('cages')
          .select('id, name, status')
          .eq('status', 'active') // Only show active cages for data entry
          .order('name')

        if (error) throw error
        console.log('Fetched cages for selector:', data)
        setCages(data || [])

        // Set default cage if none is selected
        if (!selectedCage && data && data.length > 0) {
          setSelectedCage(data[0].id)
        }
      } catch (error) {
        console.error('Error fetching cages for header:', error.message)
      } finally {
        setLoading(false)
      }
    }

    if (showCageSelector) {
      fetchCages()
    }
  }, [showCageSelector, propCages, selectedCage, setSelectedCage])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.altKey) && event.key === 'c') {
        event.preventDefault();
        const selectElement = document.getElementById('cage-selector');
        if (selectElement) {
          selectElement.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <header className="bg-white shadow">
      <div className="flex justify-between items-center px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800">{title}</h1>

        {/* Cage selector - only show for data entry forms */}
        {showCageSelector && (
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">
              Select Cage:
            </label>
            {loading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-gray-500">Loading...</span>
              </div>
            ) : cages && cages.length > 0 ? (
              <select
                id="cage-selector"
                value={selectedCage || ''}
                onChange={(e) => setSelectedCage(e.target.value)}
                className="block w-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              >
                <option value="" disabled>
                  Select a cage
                </option>
                {cages.map((cage) => (
                  <option key={cage.id} value={cage.id}>
                    {cage.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-gray-500">
                No active cages available
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
