import { useEffect, useRef, useState } from 'react'
import { X, Send, KeyRound, Loader2, MessageCircle } from 'lucide-react'
import { useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import {
  LLM_PROVIDERS,
  loadLlmSettings,
  saveLlmSettings,
  clearLlmSettings,
  chatCompletion,
  fetchLlmEnvStatus,
} from '../lib/llmClient'
import { Button, Field, Input, Select } from './ui'

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
 * Floating farm assistant.
 * Keys: .env (GEMINI_API_KEY etc.) via /api/llm, or optional localStorage override.
 */
export default function AiAssistant() {
  const { user: authUser, canUseApp } = useAuth()
  // Tenant data only once access is confirmed (password changed, company approved).
  const user = canUseApp ? authUser : null
  const aiStatus = useQuery(api.companies.aiAssistantStatus, user ? {} : 'skip')
  const [open, setOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [settings, setSettings] = useState(() => loadLlmSettings())
  const [envStatus, setEnvStatus] = useState(null)
  const [draftKey, setDraftKey] = useState('')
  const [draftModel, setDraftModel] = useState('')
  const [draftBaseUrl, setDraftBaseUrl] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Ask about cages, feed, mortality, or growth. Gemini can use GEMINI_API_KEY from your env, or set a key here.',
    },
  ])
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const provider = LLM_PROVIDERS[settings.provider] || LLM_PROVIDERS.gemini
  const hasLocalKey = Boolean((settings.keys?.[settings.provider] || '').trim())
  const hasEnvKey = Boolean(envStatus?.providers?.[settings.provider])
  const hasKey = hasLocalKey || hasEnvKey

  useEffect(() => {
    if (typeof window === 'undefined') return
    const loaded = loadLlmSettings()
    // Prefer Gemini when no explicit local key for another provider
    const next =
      !String(loaded.keys?.[loaded.provider] || '').trim() &&
      loaded.provider !== 'gemini'
        ? { ...loaded, provider: 'gemini' }
        : loaded
    setSettings(next)
    if (next !== loaded) saveLlmSettings(next)
  }, [])

  // Only hit /api/llm/status when the panel is opened (avoids polling on every page).
  useEffect(() => {
    if (!open || envStatus) return
    fetchLlmEnvStatus().then((status) => {
      if (!status) return
      setEnvStatus(status)
      if (status.defaultProvider) {
        setSettings((prev) => {
          const hasLocal = Boolean(
            String(prev.keys?.[prev.provider] || '').trim(),
          )
          if (hasLocal) return prev
          if (prev.provider === status.defaultProvider) return prev
          const updated = { ...prev, provider: status.defaultProvider }
          saveLlmSettings(updated)
          return updated
        })
      }
    })
  }, [open, envStatus])

  useEffect(() => {
    if (!showKey) return
    setDraftKey(settings.keys?.[settings.provider] || '')
    setDraftModel(
      settings.models?.[settings.provider] || provider.defaultModel,
    )
    setDraftBaseUrl(settings.customBaseUrl || '')
  }, [showKey, settings.provider])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open, busy])

  useEffect(() => {
    if (open && !showKey) {
      inputRef.current?.focus()
    }
  }, [open, showKey])

  if (!user || !aiStatus?.enabled) return null

  const selectProvider = (providerId) => {
    setSettings((prev) => {
      const next = { ...prev, provider: providerId }
      saveLlmSettings(next)
      return next
    })
  }

  const saveKey = () => {
    const next = {
      ...settings,
      keys: {
        ...settings.keys,
        [settings.provider]: draftKey.trim(),
      },
      models: {
        ...settings.models,
        [settings.provider]: draftModel.trim() || provider.defaultModel,
      },
      customBaseUrl:
        settings.provider === 'custom'
          ? draftBaseUrl.trim()
          : settings.customBaseUrl,
    }
    saveLlmSettings(next)
    setSettings(next)
    setShowKey(false)
  }

  const clearKey = () => {
    clearLlmSettings()
    const fresh = loadLlmSettings()
    setSettings(fresh)
    setDraftKey('')
    setDraftModel(LLM_PROVIDERS.openai.defaultModel)
    setDraftBaseUrl('')
  }

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return

    const apiKey = (settings.keys?.[settings.provider] || '').trim()
    const model = (
      settings.models?.[settings.provider] || provider.defaultModel
    ).trim()

    setInput('')
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)

    try {
      let farmContext = {}
      try {
        const client = getConvexHttpClient()
        farmContext = await client.query(api.reports.farmContextForAi, {
          asOf: new Date().toISOString().slice(0, 10),
        })
      } catch (err) {
        farmContext = { error: err.message || 'Could not load farm context' }
      }

      const system = `You are a concise aquaculture operations assistant for a fish farm management app.
Answer using the farm context JSON when relevant. If data is missing, say so and suggest what to log in the app.
Keep answers short and practical. Units: feed kg, ABW grams, FCR dimensionless.
Farm context:
${JSON.stringify(farmContext, null, 2)}`

      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }))

      // Prefer local/public key; otherwise /api/llm/chat reads GEMINI_API_KEY from env
      const reply = await chatCompletion({
        provider: settings.provider || 'gemini',
        apiKey,
        model,
        customBaseUrl: settings.customBaseUrl,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: question },
        ],
      })

      setMessages((m) => [...m, { role: 'assistant', content: reply }])
      // Refresh env status after a successful server-backed call
      if (!apiKey) {
        fetchLlmEnvStatus().then((status) => status && setEnvStatus(status))
      }
    } catch (err) {
      const msg = String(err?.message || err)
      const missingKey =
        /no api key|api key is required|add gemini_api_key/i.test(msg)
      if (missingKey) setShowKey(true)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: missingKey
            ? `No key for ${provider.label}. Add GEMINI_API_KEY to .env.local and restart the Next.js server, or paste a key here.`
            : `Could not get an answer: ${msg}`,
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-lagoon-950 text-white shadow-md flex items-center justify-center cursor-pointer transition-colors duration-200 hover:bg-lagoon-800 dark:bg-[#e4e4e7] dark:text-[#18181b] dark:hover:bg-[#fafafa] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-lake"
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        aria-expanded={open}
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden />
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-6 z-50 w-[min(100vw-2rem,22rem)] h-[min(70vh,28rem)] bg-surface border border-foam-deep rounded-xl shadow-xl flex flex-col overflow-hidden"
          role="dialog"
          aria-label="Farm assistant"
        >
          <div className="px-4 py-3 border-b border-foam-deep flex items-center justify-between shrink-0">
            <div className="min-w-0">
              <p className="font-display font-medium text-sm text-chart-ink">Assistant</p>
              <p className="text-xs text-muted truncate">
                {provider.label}
                {hasLocalKey
                  ? ' · key in browser'
                  : hasEnvKey
                    ? ' · key from env'
                    : ' · add API key'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="h-10 w-10 inline-flex items-center justify-center rounded-lg text-muted cursor-pointer transition-colors duration-200 hover:bg-foam hover:text-chart-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-lake"
              aria-label="Provider and API key settings"
              aria-expanded={showKey}
            >
              <KeyRound className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {showKey && (
            <div className="p-3 border-b border-foam-deep bg-foam space-y-3 max-h-64 overflow-y-auto shrink-0">
              <Field label="Provider" htmlFor="ai-provider">
                <Select
                  id="ai-provider"
                  value={settings.provider}
                  onChange={(e) => selectProvider(e.target.value)}
                >
                  {Object.values(LLM_PROVIDERS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {settings.provider === 'custom' && (
                <Field label="Base URL" htmlFor="ai-base-url">
                  <Input
                    id="ai-base-url"
                    type="url"
                    value={draftBaseUrl}
                    onChange={(e) => setDraftBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
              )}

              <Field label="API key" htmlFor="ai-api-key">
                <Input
                  id="ai-api-key"
                  type="password"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder={provider.keyPlaceholder}
                  autoComplete="off"
                />
              </Field>

              <Field label="Model" htmlFor="ai-model">
                <div className="space-y-2">
                  {provider.models.length > 0 && (
                    <Select
                      aria-label="Pick a model"
                      value={draftModel}
                      onChange={(e) => setDraftModel(e.target.value)}
                    >
                      {provider.models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Input
                    id="ai-model"
                    type="text"
                    value={draftModel}
                    onChange={(e) => setDraftModel(e.target.value)}
                    placeholder={provider.defaultModel}
                  />
                </div>
              </Field>
              <p className="text-xs text-muted">
                Prefer server env keys (e.g. GEMINI_API_KEY in .env.local). A
                key saved here overrides env for this browser only.
                {hasEnvKey ? ' Env key detected for this provider.' : ''}
              </p>

              <div className="flex gap-2">
                <Button size="sm" onClick={saveKey} className="flex-1">
                  Save settings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearKey}
                  className="!text-signal"
                >
                  Clear all
                </Button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed rounded-lg px-3 py-2 max-w-[90%] ${
                  m.role === 'user'
                    ? 'ml-auto bg-lake-soft text-chart-ink'
                    : 'mr-auto bg-foam text-chart-ink border border-foam-deep'
                }`}
              >
                {m.role === 'assistant' && i > 0 && (
                  <span className="sr-only">Assistant: </span>
                )}
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
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
