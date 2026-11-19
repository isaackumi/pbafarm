import { useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { convexSiteUrl } from '../lib/apiBase'

/**
 * Thumbnail URLs for files that have one (CF-004): { [fileId]: url }. The
 * server grants each with the same company and site checks as a download;
 * links last a few minutes, enough to load the images once. Files without a
 * thumbnail are simply missing from the map, so callers fall back to an icon.
 */
export function useFileThumbnails(fileIds) {
  const request = useMutation(api.files.requestThumbnails)
  const key = (fileIds ?? []).filter(Boolean).join(',')
  const [urls, setUrls] = useState({})
  useEffect(() => {
    if (!key) return undefined
    let cancelled = false
    request({ fileIds: key.split(',') })
      .then((rows) => {
        if (!cancelled) setUrls(Object.fromEntries(rows.map((r) => [r.fileId, `${convexSiteUrl()}${r.path}`])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key, request])
  return key ? urls : {}
}
