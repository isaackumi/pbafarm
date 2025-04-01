// components/Header.js
import React from 'react'

const Header = ({
  title,
  activeTab,
  selectedCage,
  setSelectedCage,
  cages,
  showCageSelector = false,
}) => {
  return (
    <header className="bg-white shadow">
      <div className="flex justify-between items-center px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800">{title}</h1>

        {/* Cage selector - only show for data entry forms */}
        {showCageSelector && cages && cages.length > 0 && (
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">
              Select Cage:
            </label>
            <select
              value={selectedCage}
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
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
