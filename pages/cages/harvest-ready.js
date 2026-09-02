import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function HarvestReadyCagesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cages?filter=ready_to_harvest')
  }, [router])
  return null
}
