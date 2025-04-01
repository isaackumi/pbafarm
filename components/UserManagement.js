// components/UserManagement.js
import { useState, useEffect } from 'react'
import { Edit, Trash, UserPlus, Mail, Key, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const UserManagement = () => {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    role: 'user',
  })

  useEffect(() => {
    fetchUsers()
  }, [])

  // Fetch all users from the profiles table
  const fetchUsers = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      setUsers(data || [])
    } catch (error) {
      console.error('Error fetching users:', error.message)
      setError('Error loading users. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Handle form input changes
  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  // Handle form submission to create a new user
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setMessage(null)

    try {
      // Validate form
      if (!formData.email || !formData.password || !formData.fullName) {
        setError('All fields are required')
        return
      }

      // Create user in Supabase Auth
      const { data, error } = await supabase.auth.admin.createUser({
        email: formData.email,
        password: formData.password,
        user_metadata: { full_name: formData.fullName },
      })

      if (error) throw error

      // Update the user's role in the profiles table
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: formData.role })
        .eq('id', data.user.id)

      if (updateError) throw updateError

      // Success
      setMessage('User created successfully')
      setFormData({
        email: '',
        password: '',
        fullName: '',
        role: 'user',
      })
      setShowAddUser(false)

      // Refresh user list
      fetchUsers()
    } catch (error) {
      console.error('Error creating user:', error.message)
      setError(error.message)
    }
  }

  // Update user role
  const updateUserRole = async (userId, newRole) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId)

      if (error) throw error

      // Refresh user list
      fetchUsers()
      setMessage(`User role updated to ${newRole}`)
    } catch (error) {
      console.error('Error updating user role:', error.message)
      setError(error.message)
    }
  }

  // Delete user (only for display - real implementation would require admin API)
  const deleteUser = async (userId) => {
    if (
      !confirm(
        'Are you sure you want to delete this user? This action cannot be undone.',
      )
    ) {
      return
    }

    try {
      // In a real implementation, you would use Supabase admin API to delete a user
      // For now, we'll just simulate it with a UI update
      setUsers(users.filter((user) => user.id !== userId))
      setMessage('User deleted successfully')
    } catch (error) {
      console.error('Error deleting user:', error.message)
      setError(error.message)
    }
  }

  // Filter users based on search query
  const filteredUsers = users.filter(
    (user) =>
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden mb-6">
      {message && (
        <div className="mb-6 bg-green-50 text-green-800 p-4 rounded-md">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 text-red-800 p-4 rounded-md">
          {error}
        </div>
      )}

      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h2 className="font-medium text-gray-700">System Users</h2>
          <div className="relative">
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-3 pr-10 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
        </div>
        <button
          onClick={() => setShowAddUser(!showAddUser)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add User
        </button>
      </div>

      {showAddUser && (
        <div className="p-6 bg-gray-50 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            Add New User
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="pl-10 block w-full border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="user@example.com"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="password"
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="pl-10 block w-full border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="••••••••"
                    minLength="6"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="fullName"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Full Name
                </label>
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleChange}
                  className="block w-full border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="John Doe"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="role"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Role
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Shield className="h-4 w-4 text-gray-400" />
                  </div>
                  <select
                    id="role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    className="pl-10 block w-full border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddUser(false)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Create User
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                User
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Role
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Created
              </th>
              <th
                scope="col"
                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan="4" className="px-6 py-4 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                </td>
              </tr>
            ) : filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center">
                        <span className="text-indigo-800 font-semibold text-sm">
                          {user.full_name?.charAt(0) ||
                            user.email?.charAt(0) ||
                            '?'}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">
                          {user.full_name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full 
                      ${
                        user.role === 'super_admin'
                          ? 'bg-purple-100 text-purple-800'
                          : user.role === 'admin'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {user.role === 'super_admin'
                        ? 'Super Admin'
                        : user.role === 'admin'
                        ? 'Admin'
                        : 'User'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end space-x-3">
                      <div className="relative group">
                        <button
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Change Role"
                        >
                          <Edit className="h-5 w-5" />
                        </button>
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg hidden group-hover:block z-10">
                          <div className="py-1">
                            <button
                              onClick={() => updateUserRole(user.id, 'user')}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                            >
                              Set as User
                            </button>
                            <button
                              onClick={() => updateUserRole(user.id, 'admin')}
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                            >
                              Set as Admin
                            </button>
                            <button
                              onClick={() =>
                                updateUserRole(user.id, 'super_admin')
                              }
                              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left"
                            >
                              Set as Super Admin
                            </button>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => deleteUser(user.id)}
                        className="text-red-600 hover:text-red-900"
                        title="Delete User"
                        disabled={user.id === currentUser?.id}
                      >
                        <Trash
                          className={`h-5 w-5 ${
                            user.id === currentUser?.id
                              ? 'opacity-30 cursor-not-allowed'
                              : ''
                          }`}
                        />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan="4"
                  className="px-6 py-4 text-center text-sm text-gray-500"
                >
                  No users found matching your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default UserManagement
