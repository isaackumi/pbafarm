import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, KeyRound, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getConvexHttpClient, api } from '../lib/convexBridge'

const STORAGE_KEY = 'pbafarm_openai_api_key'
const MODEL_KEY = 'pbafarm_openai_model'

/**
 * Floating AI assistant. Uses the user's own OpenAI-compatible API key
 * (stored only in localStorage) plus live farm context from Convex.
 */
export default function AiAssistant() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Ask about cages, feed, mortality, or growth. Add your OpenAI API key (gear icon) — it stays in this browser only.',
    },
  ])
  const bottomRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setApiKey(localStorage.getItem(STORAGE_KEY) || '')
    setModel(localStorage.getItem(MODEL_KEY) || 'gpt-4o-mini')
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  if (!user) return null

  const saveKey = () => {
    localStorage.setItem(STORAGE_KEY, apiKey.trim())
    localStorage.setItem(MODEL_KEY, model.trim() || 'gpt-4o-mini')
    setShowKey(false)
  }

  const clearKey = () => {
    localStorage.removeItem(STORAGE_KEY)
    setApiKey('')
  }

  const send = async () => {
    const question = input.trim()
    if (!question || busy) return
    if (!apiKey.trim()) {
      setShowKey(true)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'Add your OpenAI API key first (stored locally in this browser).',
        },
      ])
      return
    }

    setInput('')
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)

    try {
      let farmContext = {}
      try {
        const client = getConvexHttpClient()
        farmContext = await client.query(api.reports.farmContextForAi, {})
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

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: model.trim() || 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            { role: 'system', content: system },
            ...history,
            { role: 'user', content: question },
          ],
        }),
      })

      const body = await res.json()
      if (!res.ok) {
        throw new Error(body?.error?.message || `OpenAI error ${res.status}`)
      }
      const reply =
        body?.choices?.[0]?.message?.content?.trim() ||
        'No response from the model.'
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: `Could not get an answer: ${err.message || err}`,
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
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-lagoon-800 text-white shadow-lg hover:bg-lagoon-950 flex items-center justify-center"
        aria-label="Open AI assistant"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[min(100vw-2rem,22rem)] h-[28rem] bg-surface border border-foam-deep rounded-2xl shadow-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-lagoon-950 text-white flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Farm AI</p>
              <p className="text-xs text-white/70 font-medium">
                Your API key · local only
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="p-2 rounded-md hover:bg-lagoon-800"
              aria-label="API key settings"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          </div>

          {showKey && (
            <div className="p-3 border-b border-foam-deep bg-foam space-y-2">
              <label className="block text-xs font-semibold text-chart-ink">
                OpenAI API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className="w-full border border-input-border rounded-md px-2 py-1.5 text-sm font-medium"
              />
              <label className="block text-xs font-semibold text-chart-ink">
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full border border-input-border rounded-md px-2 py-1.5 text-sm font-medium"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveKey}
                  className="flex-1 bg-lagoon-800 text-white text-xs font-bold py-1.5 rounded-md"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={clearKey}
                  className="px-3 text-xs font-semibold text-signal"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm font-medium leading-relaxed rounded-lg px-3 py-2 max-w-[90%] ${
                  m.role === 'user'
                    ? 'ml-auto bg-lagoon-800 text-white'
                    : 'mr-auto bg-foam text-chart-ink border border-foam-deep'
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-muted text-sm font-medium">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 border-t border-foam-deep flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Ask about your farm…"
              className="flex-1 border border-input-border rounded-md px-3 py-2 text-sm font-medium"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="h-10 w-10 rounded-md bg-kelp text-white flex items-center justify-center disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
