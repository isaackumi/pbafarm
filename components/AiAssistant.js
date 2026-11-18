import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { X, Send, Settings2, Loader2, MessageCircle } from 'lucide-react'
import { useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/convexBridge'
import {
  LLM_PROVIDERS,
  loadLlmSettings,
  saveLlmSettings,
  chatCompletion,
  fetchLlmEnvStatus,
} from '../lib/llmClient'
import { Button, Field, Input, Select } from './ui'
import { localToday } from '../lib/format'

function TypingDots() {
  return (
    <div
      className="mr-auto flex items-center gap-1 rounded-lg border border-foam-deep bg-foam px-3 py-2"
      aria-label="Assistant is typing"
      role="status"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-muted ai-typing-dot"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  )
}

/**
 * Floating farm assistant (ANLY-005). Every question goes to the server
 * proxy (/api/llm/chat), which holds the provider keys and adds the farm
 * context this user may see (company rollups, last 14 days). The browser
 * only picks a provider and model among those the server has keys for.
 */
/** Field entry screens with a save bar at the bottom: no floating button on phones. */
const FIELD_ROUTES = ['/daily-entry', '/biweekly-entry', '/scan']

export default function AiAssistant() {
  const router = useRouter()
  const onFieldRoute = FIELD_ROUTES.includes(router?.pathname)
  const { user: authUser, canUseApp } = useAuth()
  // Tenant data only once access is confirmed (password changed, company approved).
  const user = canUseApp ? authUser : null
  const aiStatus = useQuery(api.companies.aiAssistantStatus, user ? {} : 'skip')
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState(() => loadLlmSettings())
  const [envStatus, setEnvStatus] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Ask about your units, feed, deaths, growth or harvest timing. Answers use your farm’s recorded data.',
    },
  ])
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const configured = envStatus?.providers || {}
  const providerId = configured[settings.provider]
    ? settings.provider
    : envStatus?.defaultProvider || settings.provider || 'gemini'
  const provider = LLM_PROVIDERS[providerId] || LLM_PROVIDERS.gemini
  const model = settings.models?.[providerId] || provider.defaultModel

  // Only hit /api/llm/status when the panel is opened (avoids polling on every page).
  useEffect(() => {
    if (!open || envStatus) return
    fetchLlmEnvStatus().then((status) => status && setEnvStatus(status))
  }, [open, envStatus])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, busy])

  useEffect(() => {
    if (open && !showSettings) inputRef.current?.focus()
  }, [open, showSettings])

  if (!user || !aiStatus?.enabled || !aiStatus.canUse) return null

  const update = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveLlmSettings(next)
      return next
    })

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)
    try {
      const history = messages
        .slice(1)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }))
      const reply = await chatCompletion({
        provider: providerId,
        model,
        temperature: 0.3,
        asOf: localToday(),
        messages: [...history, { role: 'user', content: question }],
      })
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (err) {
      const msg = String(err?.message || err)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: /no api key/i.test(msg)
            ? 'The assistant has no model key on the server yet. Ask your administrator to set GEMINI_API_KEY (or another provider key) on the server.'
            : `Could not get an answer: ${msg}`,
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const available = Object.values(LLM_PROVIDERS).filter((p) => configured[p.id])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${onFieldRoute && !open ? 'hidden lg:flex' : 'flex'} fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 lg:bottom-6 lg:right-6 z-40 h-14 w-14 rounded-full bg-lagoon-950 text-white shadow-md items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-lagoon-800 dark:bg-[#e4e4e7] dark:text-[#18181b] dark:hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-lake`}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircle className="h-6 w-6" aria-hidden />}
      </button>

      {open && (
        <div
          className="fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] right-4 lg:bottom-24 lg:right-6 z-50 w-[min(100vw-2rem,22rem)] h-[min(70vh,28rem)] bg-surface border border-foam-deep rounded-xl shadow-xl flex flex-col overflow-hidden"
          role="dialog"
          aria-label="Farm assistant"
        >
          <div className="px-4 py-3 border-b border-foam-deep flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <p className="font-display font-medium text-sm text-chart-ink">Assistant</p>
              <p className="text-xs text-muted truncate">
                {envStatus && !envStatus.hasAny ? 'No model key on the server' : `${provider.label} · ${model}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-muted cursor-pointer transition-colors duration-200 hover:bg-foam hover:text-chart-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
              aria-label="Model settings"
              aria-expanded={showSettings}
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {showSettings && (
            <div className="p-3 border-b border-foam-deep bg-foam space-y-3 max-h-64 overflow-y-auto shrink-0">
              {available.length === 0 ? (
                <p className="text-xs text-muted">
                  No provider key is set on the server. An administrator adds one (for example GEMINI_API_KEY) to the server environment.
                </p>
              ) : (
                <>
                  <Field label="Provider" htmlFor="ai-provider">
                    <Select id="ai-provider" value={providerId} onChange={(e) => update({ provider: e.target.value })}>
                      {available.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {provider.models.length > 0 && (
                    <Field label="Model" htmlFor="ai-model">
                      <Select
                        id="ai-model"
                        value={model}
                        onChange={(e) => update({ models: { ...settings.models, [providerId]: e.target.value } })}
                      >
                        {provider.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <p className="text-xs text-muted">Keys stay on the server; questions and answers are not stored.</p>
                </>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'ml-auto bg-lake-soft text-chart-ink'
                    : 'mr-auto bg-foam text-chart-ink border border-foam-deep'
                }`}
              >
                {m.role === 'assistant' && i > 0 && <span className="sr-only">Assistant: </span>}
                {m.content}
              </div>
            ))}
            {busy && <TypingDots />}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 border-t border-foam-deep flex gap-2 shrink-0">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Ask about your farm…"
              className="flex-1 min-w-0"
              aria-label="Message to assistant"
              disabled={busy}
            />
            <Button
              onClick={send}
              disabled={busy || !input.trim()}
              className="w-11 shrink-0 !px-0"
              aria-label="Send message"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
