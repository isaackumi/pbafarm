// pages/dashboard.js (Updated)
import { useState, useEffect } from 'react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import Dashboard from '../components/Dashboard'
// Removed cages import as Layout fetches cages now
// import { cages } from '../data/cages'

export default function DashboardPage() {
  // Removed local state for title and showCageSelector as Layout manages this
  // const [title, setTitle] = useState('Dashboard');
  // const [showCageSelector, setShowCageSelector] = useState(false);

  // Removed handleActiveTabChange as Layout no longer passes this
  // const handleActiveTabChange = (tab) => {
  //   switch (tab) {
  //     case 'dashboard':
  //       setTitle('Dashboard');
  //       setShowCageSelector(false);
  //       break;
  //     case 'daily':
  //       setTitle('Daily Data Entry');
  //       setShowCageSelector(true);
  //       break;
  //     case 'biweekly':
  //       setTitle('Biweekly ABW');
  //       setShowCageSelector(true);
  //       break;
  //     case 'harvest':
  //       setTitle('Harvest Data');
  //       setShowCageSelector(true);
  //       break;
  //     default:
  //       setTitle('Dashboard');
  //       setShowCageSelector(false);
  //   }
  // };

  return (
    <ProtectedRoute>
      <Layout
        // title={title} // Layout now determines title based on route
        // showCageSelector={showCageSelector} // Layout now determines cage selector visibility
        // cages={cages} // Layout fetches cages internally
        // onActiveTabChange={handleActiveTabChange} // Removed as Layout doesn't pass this
      >
        <Dashboard /> {/* Dashboard component should render its content based on route/context if needed */}
      </Layout>
    </ProtectedRoute>
  );
}
