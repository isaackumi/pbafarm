// pages/register-company.js
import React from 'react'
import CompanyRegistrationPage from '../components/CompanyRegistrationsPage'
import Head from 'next/head'

export default function RegisterCompany() {
  return (
    <>
      <Head>
        <title>Register Your Company - Anowa</title>
        <meta
          name="description"
          content="Register your company to access Anowa features"
        />
      </Head>
      <CompanyRegistrationPage />
    </>
  )
}
