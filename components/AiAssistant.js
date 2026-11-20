import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { ArrowUp, Check, Copy, Loader2, Maximize2, MessageCircle, Plus, Settings2, Sparkles, Workflow, X } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../lib/convexBridge'
import {
  LLM_PROVIDERS,
  loadLlmSettings,
  saveLlmSettings,
  chatCompletion,
  draftAutomation,
  fetchLlmEnvStatus,
} from '../lib/llmClient'
import { Field, GhostButton, GradientButton, Pill, Select } from './ui'
import { isAutomationRequest } from '../lib/anowaIntent'
import { describeDraft } from '../lib/anowaDraft'
import Layout from './Layout'
import DashboardInsights from './DashboardInsights'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'

/** Field entry screens with a save bar at the bottom: no floating button on phones. */
const FIELD_ROUTES = ['/daily-entry', '/biweekly-entry', '/scan']
const FULL_PAGE = '/assistant'
const PROMPTS = ['losses', 'harvest', 'report']

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/** Access gate shared by the drawer and the full page. */
export function useAssistantAccess() {
  const { user: authUser, canUseApp } = useAuth()
  // Tenant data only once access is confirmed (password changed, company approved).
  const user = canUseApp ? authUser : null
  const aiStatus = useQuery(api.companies.aiAssistantStatus, user ? {} : 'skip')
  return {
    loading: !!user && aiStatus === undefined,
    allowed: !!user && aiStatus?.enabled === true && aiStatus.canUse === true,
    /** Anowa may draft automations for this member (company AI policy). */
    canDraft: aiStatus?.canDraftAutomations === true,
    /** Company switch is off but this member can turn it on (Company settings). */
    canTurnOn: !!user && aiStatus?.enabled === false && aiStatus.canManage === true,
  }
}

/**
 * Chat state for the farm assistant (ANLY-005). Every question goes to the
 * server proxy (/api/llm/chat), which holds the provider keys and adds the
 * farm context this user may see (company rollups, last 14 days). The
 * browser only picks a provider and model among those the server has keys for.
 */
function useAssistantChat(active, { canDraft = false } = {}) {
  const t = useT()
  const welcome = useCallback(() => [{ role: 'assistant', content: t('assistantUi.welcome') }], [t])
  const [settings, setSettings] = useState(() => loadLlmSettings())
  const [envStatus, setEnvStatus] = useState(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState(welcome)

  const configured = envStatus?.providers || {}
  const providerId = configured[settings.provider]
    ? settings.provider
    : envStatus?.defaultProvider || settings.provider || 'gemini'
  const provider = LLM_PROVIDERS[providerId] || LLM_PROVIDERS.gemini
  const model = settings.models?.[providerId] || provider.defaultModel

  // Only hit /api/llm/status once the chat is shown (avoids polling on every page).
  useEffect(() => {
    if (!active || envStatus) return
    fetchLlmEnvStatus().then((status) => status && setEnvStatus(status))
  }, [active, envStatus])

  const update = (patch) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveLlmSettings(next)
      return next
    })

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)
    // "Alert the managers when DO drops below 4": draft a rule to review (AI-AUTO-001).
    if (canDraft && isAutomationRequest(question)) {
      try {
        const result = await draftAutomation({ request: question, provider: providerId, model })
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            kind: 'draft',
            content: result.explanation || t('assistantUi.draft.intro'),
            draft: result.draft,
            problems: result.problems || [],
            catalog: result.catalog,
            startPaused: result.startPaused !== false,
            canSave: result.canSave === true,
          },
        ])
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: t('assistantUi.failed', { message: String(err?.message || err) }) },
        ])
      } finally {
        setBusy(false)
      }
      return
    }
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
          content: /no api key/i.test(msg) ? t('assistantUi.noKeyReply') : t('assistantUi.failed', { message: msg }),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    if (busy) return
    setInput('')
    setMessages(welcome())
  }

  const available = Object.values(LLM_PROVIDERS).filter((p) => configured[p.id])
  const modelLine = envStatus && !envStatus.hasAny ? t('assistantUi.noKey') : `${provider.label} · ${model}`

  return { input, setInput, busy, messages, send, reset, update, settings, providerId, provider, model, available, modelLine }
}

function TypingDots() {
  const t = useT()
  return (
    <div className="flex items-center gap-1 py-2" aria-label={t('assistantUi.typing')} role="status">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ai-typing-dot inline-block h-2 w-2 rounded-full bg-muted"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </div>
  )
}

function Avatar({ size = 'size-8' }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-pill border border-line-strong bg-bg text-cyan ${size}`} aria-hidden>
      <Sparkles size={14} />
    </span>
  )
}

/**
 * An automation Anowa drafted from the conversation (AI-AUTO-001): the rule in
 * plain words, any problems, and Create (paused unless the company's AI
 * policy says otherwise). Members without automation.manage can copy it for
 * an admin. Nothing is saved without the click.
 */
function DraftCard({ message, compact }) {
  const t = useT()
  const save = useMutation(api.automation.rules.save)
  const [state, setState] = useState({ busy: false, created: false, error: '', copied: false })
  const { draft, problems, catalog, startPaused, canSave } = message
  const words = describeDraft(draft, catalog)
  const ok = !!draft && problems.length === 0

  const create = async () => {
    setState((s) => ({ ...s, busy: true, error: '' }))
    try {
      await save({ ...draft, enabled: !startPaused })
      setState((s) => ({ ...s, busy: false, created: true }))
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: String(err?.data?.message || err?.message || err) }))
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
      setState((s) => ({ ...s, copied: true }))
    } catch {
      setState((s) => ({ ...s, error: t('assistantUi.draft.copyFailed') }))
    }
  }

  if (!draft) {
    return (
      <div className="mt-3 rounded-[14px] border border-line bg-bg p-4 text-[13px] leading-5 text-muted whitespace-normal">
        {problems[0] || t('assistantUi.draft.none')}
      </div>
    )
  }

  return (
    <div className={`mt-3 flex flex-col gap-3 rounded-[14px] border border-line bg-bg whitespace-normal ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-pill border border-line-strong text-cyan" aria-hidden>
          <Workflow size={15} />
        </span>
        <div className="min-w-0 grow basis-0">
          <p className="text-[14px] font-semibold leading-[18px] text-text">{draft.name}</p>
          <p className="mt-0.5 text-[12px] leading-4 text-muted">{words.trigger}</p>
        </div>
        <Pill tone={ok ? 'cyan' : 'amber'} size="sm">
          {ok ? t('assistantUi.draft.badge') : t('assistantUi.draft.needsFix')}
        </Pill>
      </div>

      {words.conditions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">
            {words.match === 'any' ? t('assistantUi.draft.ifAny') : t('assistantUi.draft.ifAll')}
          </p>
          <ul className="flex flex-col gap-1 text-[13px] leading-[18px] text-text">
            {words.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint">{t('assistantUi.draft.then')}</p>
        <ul className="flex flex-col gap-1 text-[13px] leading-[18px] text-text">
          {words.actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>

      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-[12px] border border-[var(--pill-amber-border)] px-3 py-2 text-[12px] leading-4 text-[var(--pill-amber-text)]">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      {state.error && <p className="text-[12px] leading-4 text-alert">{state.error}</p>}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {state.created ? (
          <>
            <Pill tone="green" size="sm">
              <Check size={12} aria-hidden />
              {startPaused ? t('assistantUi.draft.createdPaused') : t('assistantUi.draft.createdOn')}
            </Pill>
            <GhostButton size="sm" href="/automations">
              {t('assistantUi.draft.open')}
            </GhostButton>
          </>
        ) : canSave ? (
          <>
            <GradientButton variant="solid" size="sm" onClick={create} disabled={!ok || state.busy}>
              {state.busy
                ? t('assistantUi.draft.creating')
                : startPaused
                  ? t('assistantUi.draft.createPaused')
                  : t('assistantUi.draft.createOn')}
            </GradientButton>
            <GhostButton size="sm" icon={state.copied ? Check : Copy} onClick={copy}>
              {state.copied ? t('assistantUi.draft.copied') : t('assistantUi.draft.copy')}
            </GhostButton>
          </>
        ) : (
          <>
            <p className="grow basis-full text-[12px] leading-4 text-muted">{t('assistantUi.draft.askAdmin')}</p>
            <GhostButton size="sm" icon={state.copied ? Check : Copy} onClick={copy} disabled={!ok}>
              {state.copied ? t('assistantUi.draft.copied') : t('assistantUi.draft.copy')}
            </GhostButton>
          </>
        )}
      </div>
    </div>
  )
}

/** 17 message thread: user bubble right on surface-2, assistant with avatar on the left. */
function Thread({ chat, compact = false }) {
  const t = useT()
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [chat.messages, chat.busy])
  const text = compact ? 'text-[14px] leading-[20px]' : 'text-base leading-6'
  return (
    <div className={`flex flex-col ${compact ? 'gap-4' : 'gap-[22px]'}`} aria-live="polite">
      {chat.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="flex justify-end">
            <div className={`max-w-[520px] whitespace-pre-wrap rounded-t-[18px] rounded-bl-[18px] rounded-br-[4px] bg-surface-2 text-text ${compact ? 'px-4 py-3' : 'px-[18px] py-[14px]'} ${text}`}>
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className={`flex ${compact ? 'gap-3' : 'gap-[14px]'}`}>
            <Avatar size={compact ? 'size-7' : 'size-8'} />
            <div className={`min-w-0 grow basis-0 whitespace-pre-wrap pt-1 text-text ${text}`}>
              {i > 0 && <span className="sr-only">{t('assistantUi.srAssistant')} </span>}
              {m.content}
              {m.kind === 'draft' && <DraftCard message={m} compact={compact} />}
            </div>
          </div>
        ),
      )}
      {chat.busy && (
        <div className={`flex ${compact ? 'gap-3' : 'gap-[14px]'}`}>
          <Avatar size={compact ? 'size-7' : 'size-8'} />
          <TypingDots />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

/** 17 pill input bar with the round send button. */
function Composer({ chat, inputRef, compact = false }) {
  const t = useT()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        chat.send()
      }}
      className={`flex items-center gap-3 rounded-pill border border-line-strong bg-bg focus-within:border-cyan ${compact ? 'py-2 pl-4 pr-2' : 'py-[10px] pl-5 pr-[10px]'}`}
    >
      <input
        ref={inputRef}
        value={chat.input}
        onChange={(e) => chat.setInput(e.target.value)}
        placeholder={t('assistantUi.placeholder')}
        aria-label={t('assistantUi.inputLabel')}
        disabled={chat.busy}
        className="min-w-0 grow basis-0 bg-transparent text-[14px] leading-[18px] text-text placeholder:text-faint focus:outline-none"
      />
      <button
        type="submit"
        disabled={chat.busy || !chat.input.trim()}
        aria-label={t('assistantUi.send')}
        className={`flex size-9 shrink-0 items-center justify-center rounded-pill bg-button text-button-text disabled:opacity-40 ${focusRing}`}
      >
        {chat.busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArrowUp size={16} aria-hidden />}
      </button>
    </form>
  )
}

function ModelSettings({ chat, idPrefix }) {
  const t = useT()
  if (chat.available.length === 0) return <p className="text-xs text-muted">{t('assistantUi.noProvider')}</p>
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('assistantUi.provider')} htmlFor={`${idPrefix}-provider`}>
        <Select id={`${idPrefix}-provider`} value={chat.providerId} onChange={(e) => chat.update({ provider: e.target.value })}>
          {chat.available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      {chat.provider.models.length > 0 && (
        <Field label={t('assistantUi.model')} htmlFor={`${idPrefix}-model`}>
          <Select
            id={`${idPrefix}-model`}
            value={chat.model}
            onChange={(e) => chat.update({ models: { ...chat.settings.models, [chat.providerId]: e.target.value } })}
          >
            {chat.provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-xs text-muted">{t('assistantUi.privacy')}</p>
    </div>
  )
}

function IconButton({ label, onClick, href, expanded, children }) {
  const cls = `inline-flex size-9 items-center justify-center rounded-pill text-muted transition-colors hover:bg-surface-2 hover:text-text ${focusRing}`
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-expanded={expanded} className={cls}>
      {children}
    </button>
  )
}

/** Floating assistant drawer, mounted once in _app. */
export default function AiAssistant() {
  const t = useT()
  const router = useRouter()
  const pathname = router?.pathname
  const onFieldRoute = FIELD_ROUTES.includes(pathname)
  const { allowed, canDraft } = useAssistantAccess()
  const [open, setOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const chat = useAssistantChat(open, { canDraft })
  const inputRef = useRef(null)

  useEffect(() => {
    if (open && !showSettings) inputRef.current?.focus()
  }, [open, showSettings])

  if (!allowed || pathname === FULL_PAGE) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${onFieldRoute && !open ? 'hidden lg:flex' : 'flex'} fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 size-14 items-center justify-center rounded-full bg-button text-button-text shadow-[var(--shadow-card)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg lg:bottom-6 lg:right-6`}
        aria-label={open ? t('assistantUi.close') : t('assistantUi.open')}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <MessageCircle className="h-6 w-6" aria-hidden />}
      </button>

      {open && (
        <div
          className="fixed bottom-[calc(9.5rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-[min(72vh,34rem)] w-[min(100vw-2rem,24rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)] lg:bottom-24 lg:right-6"
          role="dialog"
          aria-label={t('assistantUi.dialog')}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
            <Avatar />
            <div className="min-w-0 grow">
              <p className="text-[14px] font-semibold leading-[18px] text-text">{t('assistantUi.title')}</p>
              <p className="truncate text-xs text-muted">{chat.modelLine}</p>
            </div>
            <IconButton label={t('assistantUi.newChat')} onClick={chat.reset}>
              <Plus size={16} aria-hidden />
            </IconButton>
            <IconButton label={t('assistantUi.settings')} onClick={() => setShowSettings((s) => !s)} expanded={showSettings}>
              <Settings2 size={16} aria-hidden />
            </IconButton>
            <IconButton label={t('assistantUi.fullPage')} href={FULL_PAGE}>
              <Maximize2 size={16} aria-hidden />
            </IconButton>
          </div>

          {showSettings && (
            <div className="max-h-64 shrink-0 overflow-y-auto border-b border-line bg-surface-2 p-4">
              <ModelSettings chat={chat} idPrefix="ai-drawer" />
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            <Thread chat={chat} compact />
          </div>

          <div className="shrink-0 border-t border-line p-3">
            <Composer chat={chat} inputRef={inputRef} compact />
          </div>
        </div>
      )}
    </>
  )
}

/** 17 Ask Anowa full page: chat on the left, insights and prompts on the right. */
export function AssistantPage() {
  const t = useT()
  const { locationArgs } = useLocation()
  const { loading, allowed, canDraft, canTurnOn } = useAssistantAccess()
  const chat = useAssistantChat(allowed, { canDraft })
  const startAutomation = () => {
    chat.setInput(t('assistantUi.draft.prefix'))
    inputRef.current?.focus()
  }
  const inputRef = useRef(null)
  const [showSettings, setShowSettings] = useState(false)
  const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
  const fresh = chat.messages.length === 1

  return (
    <Layout
      title={t('assistantUi.title')}
      eyebrow={allowed ? `${t('assistantUi.eyebrow')} · ${chat.modelLine}` : t('assistantUi.eyebrow')}
      actions={
        allowed && (
          <GradientButton icon={Plus} onClick={chat.reset} disabled={chat.busy}>
            {t('assistantUi.newChat')}
          </GradientButton>
        )
      }
    >
      {loading ? (
        <div className={`${card} h-64 animate-pulse`} />
      ) : !allowed ? (
        <section className={`${card} flex flex-col items-center gap-3 px-6 py-14 text-center`}>
          <Sparkles size={28} className="text-faint" aria-hidden />
          <h2 className="text-[17px] font-semibold text-text">{t('assistantUi.offTitle')}</h2>
          <p className="max-w-md text-[14px] text-muted">
            {canTurnOn ? t('assistantUi.offAdmin') : t('assistantUi.offBody')}
          </p>
          {canTurnOn && (
            <GradientButton icon={Sparkles} href="/company-settings" className="mt-2">
              {t('assistantUi.turnOn')}
            </GradientButton>
          )}
        </section>
      ) : (
        <div className="flex w-full flex-col items-start gap-5 xl:flex-row">
          <section aria-label={t('assistantUi.dialog')} className={`${card} flex w-full min-w-0 flex-col gap-[22px] p-5 sm:p-7 xl:grow-[1.7] xl:basis-0`}>
            <Thread chat={chat} />
            {fresh && (
              <div className="flex flex-wrap gap-[10px] pl-0 sm:pl-[46px]">
                {PROMPTS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => chat.send(t(`assistantUi.prompt.${k}`))}
                    className={`rounded-pill border border-line-strong px-[14px] py-2 text-[13px] leading-4 text-text hover:bg-surface-2 ${focusRing}`}
                  >
                    {t(`assistantUi.prompt.${k}`)}
                  </button>
                ))}
                {canDraft && (
                  <button
                    type="button"
                    onClick={startAutomation}
                    className={`inline-flex items-center gap-1.5 rounded-pill border border-line-strong px-[14px] py-2 text-[13px] leading-4 text-text hover:bg-surface-2 ${focusRing}`}
                  >
                    <Workflow size={14} className="text-cyan" aria-hidden />
                    {t('assistantUi.draft.chip')}
                  </button>
                )}
              </div>
            )}
            <Composer chat={chat} inputRef={inputRef} />
            <div className="flex items-center justify-between gap-3 text-xs text-faint">
              <span>{t('assistantUi.privacy')}</span>
              <button
                type="button"
                onClick={() => setShowSettings((s) => !s)}
                aria-expanded={showSettings}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2 py-1 text-muted hover:text-text ${focusRing}`}
              >
                <Settings2 size={14} aria-hidden />
                {t('assistantUi.settings')}
              </button>
            </div>
            {showSettings && (
              <div className="rounded-[14px] border border-line bg-bg p-4">
                <ModelSettings chat={chat} idPrefix="ai-page" />
              </div>
            )}
          </section>
          <div className="flex w-full flex-col gap-5 xl:basis-0 xl:grow">
            <DashboardInsights locationId={locationArgs?.locationId} aiEnabled title={t('assistantUi.insights')} />
            <section aria-labelledby="ai-try-title" className={`${card} flex flex-col gap-[10px] px-[26px] py-6`}>
              <h2 id="ai-try-title" className="pb-[6px] text-[15px] font-semibold leading-[18px] text-text">
                {t('assistantUi.tryAsking')}
              </h2>
              {PROMPTS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    chat.setInput(t(`assistantUi.prompt.${k}`))
                    inputRef.current?.focus()
                  }}
                  className={`rounded-[12px] bg-surface-2 px-[14px] py-3 text-left text-[13px] leading-4 text-text hover:bg-line ${focusRing}`}
                >
                  {t(`assistantUi.prompt.${k}`)}
                </button>
              ))}
              {canDraft && (
                <button
                  type="button"
                  onClick={() => {
                    chat.setInput(t('assistantUi.draft.example'))
                    inputRef.current?.focus()
                  }}
                  className={`flex items-center gap-2 rounded-[12px] bg-surface-2 px-[14px] py-3 text-left text-[13px] leading-4 text-text hover:bg-line ${focusRing}`}
                >
                  <Workflow size={14} className="shrink-0 text-cyan" aria-hidden />
                  {t('assistantUi.draft.example')}
                </button>
              )}
            </section>
          </div>
        </div>
      )}
    </Layout>
  )
}
