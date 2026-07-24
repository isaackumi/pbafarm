import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function ActiveCagesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cages?filter=active')
  }, [router])
  return null
}
