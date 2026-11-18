import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Paperclip } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Button } from './ui'
import { convexSiteUrl } from '../lib/apiBase'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'
import { sha256HexOfFile } from '../lib/fileHash'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.csv,.txt,.xls,.xlsx,.doc,.docx'
const MAX_BYTES = 10 * 1024 * 1024

const size = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

/**
 * Files attached to one record (TRACE-005): list, upload, download through a
 * short-lived link, remove. `entityType` is the table name of the record.
 */
export default function Attachments({ entityType, entityId, compact = false }) {
  const { user, hasRole } = useAuth()
  const isAdmin = usePermission('production.records.delete')
  const { showToast } = useToast()
  const files = useQuery(api.files.list, user && entityId ? { entityType, entityId } : 'skip')
  const generateUploadUrl = useMutation(api.files.generateUploadUrl)
  const attach = useMutation(api.files.attach)
  const requestDownload = useMutation(api.files.requestDownload)
  const remove = useMutation(api.files.remove)
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      showToast('error', 'Files can be at most 10 MB')
      return
    }
    setBusy(true)
    try {
      const { uploadUrl, uploadId } = await generateUploadUrl({
        entityType,
        entityId,
        sha256: await sha256HexOfFile(file),
      })
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!res.ok) throw new Error('Upload failed. Try again.')
      const { storageId } = await res.json()
      const out = await attach({ entityType, entityId, uploadId, storageId, name: file.name })
      if (!out.ok) throw new Error(out.message)
      showToast('success', `${file.name} attached`)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not attach the file'))
    } finally {
      setBusy(false)
    }
  }

  const open = async (f) => {
    try {
      const { path } = await requestDownload({ fileId: f.id })
      window.open(`${convexSiteUrl()}${path}`, '_blank', 'noopener')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not open the file'))
    }
  }

  const drop = async (f) => {
    if (!window.confirm(`Remove ${f.name}?`)) return
    try {
      await remove({ fileId: f.id })
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not remove the file'))
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {files && files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <button type="button" onClick={() => open(f)} className="inline-flex items-center gap-1.5 text-lake hover:underline text-left">
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {f.name}
              </button>
              <span className="text-xs text-muted">{size(f.size)}</span>
              {(isAdmin || f.uploaded_by === user?.id) && (
                <button type="button" onClick={() => drop(f)} className="text-xs text-signal hover:underline print:hidden">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {files && files.length === 0 && !compact && <p className="text-sm text-muted">No documents attached.</p>}
      <div className="print:hidden">
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={onPick} aria-label="Attach a document" />
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : 'Attach document'}
        </Button>
      </div>
    </div>
  )
}
