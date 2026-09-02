// Stub component for CompanyRegistrationsPage
import React, { useState } from 'react'
import companyService from '../lib/companyService'

const CompanyRegistrationsPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    registrationNumber: ''
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      setLoading(true)
      const response = await companyService.registerCompany(formData)
      
      if (response.error) {
        throw response.error
      }

      alert('Company registration submitted successfully! Awaiting admin approval.')
      setFormData({
        name: '',
        email: '',
        phone: '',
        address: '',
        registrationNumber: ''
      })
    } catch (error) {
      console.error('Error registering company:', error)
      alert('Error registering company: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Register Company</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Company Name</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Phone</label>
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Address</label>
          <textarea
            name="address"
            value={formData.address}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            rows="3"
            required
          />
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Registration Number</label>
          <input
            type="text"
            name="registrationNumber"
            value={formData.registrationNumber}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-lagoon-800 text-white py-2 rounded hover:bg-lagoon-800 disabled:opacity-50"
        >
          {loading ? 'Registering...' : 'Register Company'}
        </button>
      </form>
    </div>
  )
}

export default CompanyRegistrationsPage