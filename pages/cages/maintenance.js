import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function MaintenanceCagesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cages?filter=maintenance')
  }, [router])
  return null
}
