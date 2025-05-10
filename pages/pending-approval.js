// pages/pending-approval.js
import React from 'react'
import PendingApprovalPage from '../components/PendingApprovalPage'
import Head from 'next/head'

export default function PendingApproval() {
  return (
    <>
      <Head>
        <title>Registration Status - PBA Farm Management</title>
        <meta
          name="description"
          content="Check your company registration status"
        />
      </Head>
      <PendingApprovalPage />
    </>
  )
}
