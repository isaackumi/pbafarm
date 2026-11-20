import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation } from 'convex/react'
import {
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  Calendar,
  Check,
  ChevronDown,
  CornerDownRight,
  FileText,
  Loader2,
  MapPin,
  Menu,
  MessageCircle,
  Minimize2,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { api } from '../lib/convexBridge'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { usePermissions } from '../hooks/usePermission'
import { useDialogA11y } from '../hooks/useDialogA11y'
import { useLocation } from '../contexts/LocationContext'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useLocale, useT } from '../lib/i18n/context'
import { chatCompletion, draftAutomation, fetchLlmModels } from '../lib/llmClient'
import { isAutomationRequest } from '../lib/anowaIntent'
import { localToday } from '../lib/format'
import { errorMessage } from '../lib/errorMessage'
import {
  AUTO,
  DEFAULT_RANGE_DAYS,
  RANGE_DAYS,
  TOPICS,
  formatSourceCount,
  historyFor,
  modelMenu,
  parseDeepLink,
  requestModel,
  resolveChoice,
  topicColumns,
} from '../lib/askAnowa'
import { AnowaLockup } from './brand/AnowaLogo'
import { initials } from './ui'
import Layout from './Layout'
import { AssistantOff, Thread, useAssistantAccess } from './AiAssistant'

/**
 * Ask Anowa, expanded (Paper artboards 47 and 47b): a full-screen assistant
 * with its own rail (new chat, Ask / Reports / Automations / Saved answers,
 * recent conversations, back to the farm), a model chip fed by the live
 * model list (D-022), and a composer whose chips narrow the farm context the
 * server builds (site, date window, deep analysis). Conversations are saved
 * per member (convex/assistantChats). The compact bubble (AiAssistant) and
 * the top-bar "Ask Anowa" button open this page.
 */

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const MODEL_KEY = 'anowa.askModel'

function loadChoice() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage.getItem(MODEL_KEY)
    return raw ? JSON.parse(raw) : AUTO
  } catch {
    return AUTO
  }
}

function saveChoice(choice) {
  try {
    window.localStorage.setItem(MODEL_KEY, JSON.stringify(choice))
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

/** Leave the takeover: back where the member came from, else the dashboard. */
function useCollapse() {
  const router = useRouter()
  return useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/dashboard')
  }, [router])
}

export default function AskAnowaPage() {
  const t = useT()
  const { loading, allowed, canTurnOn } = useAssistantAccess()
  if (loading) {
    return <div className="h-dvh animate-pulse bg-bg" aria-busy="true" aria-label={t('askAnowa.title')} />
  }
  if (!allowed) {
    return (
      <Layout title={t('assistantUi.title')}>
        <AssistantOff canTurnOn={canTurnOn} />
      </Layout>
    )
  }
  return <AskAnowa />
}

function AskAnowa() {
  const t = useT()
  const router = useRouter()
  const collapse = useCollapse()
  const { canDraft } = useAssistantAccess()
  const { locations, activeLocationId } = useLocation()
  const deepLink = parseDeepLink(router.query)

  // Composer scope (artboard 47 chips).
  const [deep, setDeep] = useState(false)
  const [siteId, setSiteId] = useState(activeLocationId || '')
  const [days, setDays] = useState(DEFAULT_RANGE_DAYS)
  const [topic, setTopic] = useState(TOPICS[0])
  useEffect(() => {
    if (activeLocationId) setSiteId((s) => s || activeLocationId)
  }, [activeLocationId])

  // Live model list (47b).
  const [catalog, setCatalog] = useState(null)
  const [catalogError, setCatalogError] = useState('')
  const [choice, setChoiceState] = useState(AUTO)
  useEffect(() => setChoiceState(loadChoice()), [])
  useEffect(() => {
    let live = true
    fetchLlmModels()
      .then((c) => live && setCatalog(c))
      .catch((err) => live && setCatalogError(String(err?.message || err)))
    return () => {
      live = false
    }
  }, [])
  const effectiveChoice = catalog ? resolveChoice(choice, catalog) : choice
  const setChoice = (c) => {
    setChoiceState(c)
    saveChoice(c)
  }

  // Conversation.
  const [chatId, setChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const loadedRef = useRef(null)
  const inputRef = useRef(null)
  const append = useMutation(api.assistantChats.append)
  const setPinned = useMutation(api.assistantChats.setPinned)
  const removeChat = useMutation(api.assistantChats.remove)
  const recent = useOptionalQuery(api.assistantChats.list, {}, [])
  const opened = useOptionalQuery(
    api.assistantChats.get,
    deepLink.chat && deepLink.chat !== loadedRef.current ? { chatId: deepLink.chat } : 'skip',
    'missing',
  )
  const [notice, setNotice] = useState('')

  // Open a conversation from the rail or a deep link (?chat=…).
  useEffect(() => {
    if (!deepLink.chat) {
      if (loadedRef.current) {
        loadedRef.current = null
        setChatId(null)
        setMessages([])
      }
      return
    }
    if (deepLink.chat === loadedRef.current || opened === undefined) return
    if (opened === 'missing' || !opened) {
      setNotice(t('askAnowa.chatMissing'))
      loadedRef.current = deepLink.chat
      setChatId(null)
      setMessages([])
      return
    }
    loadedRef.current = deepLink.chat
    setNotice('')
    setChatId(opened.chat._id)
    setMessages(opened.messages.map((m) => ({ ...m })))
  }, [deepLink.chat, opened, t])

  const go = useCallback(
    (query) => router.push({ pathname: '/assistant', query }, undefined, { shallow: true }),
    [router],
  )

  const newChat = () => {
    if (busy) return
    loadedRef.current = null
    setChatId(null)
    setMessages([])
    setNotice('')
    setInput('')
    go({})
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const persist = async (turns) => {
    try {
      const res = await append({ ...(chatId ? { chatId } : {}), messages: turns })
      if (!chatId) {
        loadedRef.current = res.chatId
        setChatId(res.chatId)
        go({ chat: res.chatId })
      }
      return res.messageIds
    } catch (err) {
      const full = err?.data?.reason === 'CHAT_FULL'
      setNotice(full ? t('askAnowa.chatFull') : t('askAnowa.historyFailed', { message: errorMessage(err) }))
      return null
    }
  }

  const send = async (text) => {
    const question = (text ?? input).trim()
    if (!question || busy) return
    setInput('')
    setNotice('')
    const userMsg = { role: 'user', content: question }
    const history = historyFor(messages)
    setMessages((m) => [...m, userMsg])
    setBusy(true)
    const { provider, model } = requestModel(effectiveChoice)
    let answer
    try {
      if (canDraft && isAutomationRequest(question)) {
        const result = await draftAutomation({ request: question, provider, model })
        answer = {
          role: 'assistant',
          kind: 'draft',
          content: result.explanation || t('assistantUi.draft.intro'),
          draft: result.draft,
          problems: result.problems || [],
          catalog: result.catalog,
          startPaused: result.startPaused !== false,
          canSave: result.canSave === true,
        }
      } else {
        const reply = await chatCompletion({
          provider,
          model,
          temperature: 0.3,
          asOf: localToday(),
          days,
          deep,
          locationId: siteId || undefined,
          messages: [...history, userMsg],
        })
        answer = { role: 'assistant', content: reply.text }
      }
    } catch (err) {
      const msg = String(err?.message || err)
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          failed: true,
          content: /no api key/i.test(msg) ? t('assistantUi.noKeyReply') : t('assistantUi.failed', { message: msg }),
        },
      ])
      setBusy(false)
      return
    }
    setMessages((m) => [...m, answer])
    // Still busy while saving, so a quick follow-up joins this conversation instead of starting another.
    const ids = await persist([userMsg, { role: 'assistant', content: answer.content }])
    setBusy(false)
    if (ids) {
      setMessages((m) => {
        const next = [...m]
        // The last two local turns are the ones just saved.
        const a = next.lastIndexOf(answer)
        const u = next.lastIndexOf(userMsg)
        if (u >= 0) next[u] = { ...userMsg, _id: ids[0] }
        if (a >= 0) next[a] = { ...answer, _id: ids[1], pinned: false }
        return next
      })
    }
  }

  const togglePin = async (m) => {
    if (!m._id) return
    const pinned = !m.pinned
    setMessages((all) => all.map((x) => (x._id === m._id ? { ...x, pinned } : x)))
    try {
      await setPinned({ messageId: m._id, pinned })
    } catch (err) {
      setMessages((all) => all.map((x) => (x._id === m._id ? { ...x, pinned: !pinned } : x)))
      setNotice(errorMessage(err))
    }
  }

  const deleteChat = async (id) => {
    try {
      await removeChat({ chatId: id })
      if (id === chatId) newChat()
    } catch (err) {
      setNotice(t('askAnowa.deleteFailed', { message: errorMessage(err) }))
    }
  }

  // Drawer (phones) and model menu; Esc closes the open one, else collapses.
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (menu) setMenu(false)
      else if (drawer) setDrawer(false)
      else collapse()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, drawer, collapse])

  const view = deepLink.view
  const started = messages.length > 0 || busy
  const chat = { messages, busy }
  const scope = { deep, setDeep, siteId, setSiteId, days, setDays, locations }

  const rail = (
    <Rail
      t={t}
      recent={recent || []}
      activeChatId={chatId}
      view={view}
      onNewChat={() => {
        setDrawer(false)
        newChat()
      }}
      onOpen={(id) => {
        setDrawer(false)
        go({ chat: id })
      }}
      onView={(v) => {
        setDrawer(false)
        go(v === 'saved' ? { view: 'saved' } : chatId ? { chat: chatId } : {})
      }}
      onDelete={deleteChat}
      onCollapse={collapse}
    />
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text antialiased">
      <aside
        aria-label={t('askAnowa.railLabel')}
        className="hidden w-[264px] shrink-0 border-r border-line lg:flex"
      >
        {rail}
      </aside>
      {drawer && <Drawer onClose={() => setDrawer(false)}>{rail}</Drawer>}

      <main className="flex min-w-0 grow basis-0 flex-col items-center px-4 pb-6 pt-4 sm:px-10 sm:pb-8 sm:pt-6">
        <TopBar
          t={t}
          onMenu={() => setDrawer(true)}
          menuOpen={menu}
          setMenuOpen={setMenu}
          catalog={catalog}
          catalogError={catalogError}
          choice={effectiveChoice}
          setChoice={setChoice}
        />

        {view === 'saved' ? (
          <SavedAnswers t={t} onOpen={(id) => go({ chat: id })} />
        ) : started ? (
          <>
            <div className="mt-4 flex w-full min-h-0 grow basis-0 justify-center overflow-y-auto">
              <div className="w-full max-w-[820px] py-4">
                <Thread
                  chat={chat}
                  renderActions={(m) =>
                    m._id && m.role === 'assistant' ? <SaveButton t={t} message={m} onToggle={togglePin} /> : null
                  }
                />
              </div>
            </div>
            {notice && <Notice text={notice} />}
            <div className="w-full max-w-[820px] shrink-0 pt-3">
              <Composer t={t} input={input} setInput={setInput} send={send} busy={busy} inputRef={inputRef} scope={scope} />
            </div>
            <Sources t={t} days={days} siteId={siteId} className="mt-4" />
          </>
        ) : (
          <div className="flex w-full grow basis-0 flex-col items-center overflow-y-auto">
            <div className="flex flex-col items-center gap-4 pb-10 pt-12 text-center sm:pb-16 sm:pt-[112px]">
              <h1 className="font-serif text-[44px] font-normal leading-[48px] tracking-[-0.02em] text-text sm:text-[68px] sm:leading-[72px]">
                {t('askAnowa.headline')}
              </h1>
              <p className="max-w-[520px] text-base leading-6 text-muted">{t('askAnowa.subtitle')}</p>
            </div>
            {notice && <Notice text={notice} />}
            <div className="w-full max-w-[820px]">
              <Composer t={t} input={input} setInput={setInput} send={send} busy={busy} inputRef={inputRef} scope={scope} autoFocus />
            </div>
            <Topics t={t} topic={topic} setTopic={setTopic} onAsk={(q) => send(q)} />
            <Sources t={t} days={days} siteId={siteId} className="mt-auto pt-10" />
          </div>
        )}
      </main>
    </div>
  )
}

function Notice({ text }) {
  return (
    <p role="status" className="mt-3 w-full max-w-[820px] rounded-[12px] border border-line bg-surface px-4 py-2 text-[13px] leading-[18px] text-muted">
      {text}
    </p>
  )
}

/* ─── Rail ─────────────────────────────────────────────────────────────── */

function Rail({ t, recent, activeChatId, view, onNewChat, onOpen, onView, onDelete, onCollapse }) {
  const { can } = usePermissions()
  const { company } = useCompanySettings()
  const { user } = useAuth()
  const farm = company?.name || user?.companyName || ''
  const nav = [
    { key: 'ask', icon: MessageCircle, active: view !== 'saved', onClick: () => onView('ask') },
    can('reports.view') && { key: 'reports', icon: FileText, href: '/weekly-report' },
    can('automation.manage') && { key: 'automations', icon: Zap, href: '/automations' },
    { key: 'saved', icon: Bookmark, active: view === 'saved', onClick: () => onView('saved') },
  ].filter(Boolean)
  const item = (active) =>
    `flex w-full items-center gap-3 rounded-[12px] px-[14px] py-[10px] text-left text-[15px] leading-[18px] transition-colors ${FOCUS} ${
      active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
    }`

  return (
    <div className="flex h-full w-full flex-col gap-7 px-4 py-6">
      <div className="flex items-center justify-between px-[6px]">
        <Link href="/dashboard" className={`rounded-[6px] ${FOCUS}`}>
          <AnowaLockup height={22} />
        </Link>
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t('askAnowa.collapse')}
          title={t('askAnowa.collapse')}
          className={`flex size-8 shrink-0 items-center justify-center rounded-pill border border-line-strong text-muted hover:text-text ${FOCUS}`}
        >
          <Minimize2 size={14} aria-hidden />
        </button>
      </div>

      <button
        type="button"
        onClick={onNewChat}
        className={`flex items-center gap-[10px] rounded-pill bg-text px-4 py-3 text-[15px] font-medium leading-[18px] text-bg hover:opacity-90 ${FOCUS}`}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden />
        {t('askAnowa.newChat')}
      </button>

      <nav className="flex flex-col gap-[2px]">
        {nav.map((n) => {
          const Icon = n.icon
          const body = (
            <>
              <span className="flex w-5 shrink-0 justify-center">
                <Icon size={18} strokeWidth={1.7} aria-hidden />
              </span>
              {t(`askAnowa.nav.${n.key}`)}
            </>
          )
          return n.href ? (
            <Link key={n.key} href={n.href} className={item(false)}>
              {body}
            </Link>
          ) : (
            <button key={n.key} type="button" onClick={n.onClick} aria-current={n.active ? 'page' : undefined} className={item(n.active)}>
              {body}
            </button>
          )
        })}
      </nav>

      <div className="flex min-h-0 grow basis-0 flex-col gap-1">
        <h2 className="px-[14px] pb-2 text-xs font-normal leading-4 text-faint">{t('askAnowa.recent')}</h2>
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {recent.length === 0 && <li className="px-[14px] py-2 text-[13px] leading-4 text-faint">{t('askAnowa.noRecent')}</li>}
          {recent.map((c) => (
            <li key={c._id} className="group flex items-center rounded-[10px] hover:bg-surface-2">
              <button
                type="button"
                onClick={() => onOpen(c._id)}
                aria-current={c._id === activeChatId ? 'true' : undefined}
                className={`min-w-0 grow truncate rounded-[10px] px-[14px] py-2 text-left text-[13px] leading-4 ${
                  c._id === activeChatId ? 'text-text' : 'text-muted'
                } ${FOCUS}`}
              >
                {c.title}
              </button>
              <button
                type="button"
                onClick={() => onDelete(c._id)}
                aria-label={t('askAnowa.deleteChat', { title: c.title })}
                title={t('askAnowa.deleteChat', { title: c.title })}
                className={`mr-1 flex size-7 shrink-0 items-center justify-center rounded-pill text-faint opacity-100 hover:text-alert lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 ${FOCUS}`}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <p className="px-[14px] pt-2 text-xs leading-4 text-faint">{t('askAnowa.historyNote')}</p>
      </div>

      <Link href="/dashboard" className={`flex items-center gap-3 border-t border-line px-[14px] py-3 ${FOCUS}`}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-2 text-[11px] font-semibold leading-[14px] text-text">
          {initials(farm || 'A')}
        </span>
        <span className="flex min-w-0 flex-col gap-[2px]">
          {farm && <span className="truncate text-[13px] leading-4 text-text">{farm}</span>}
          <span className="text-xs leading-4 text-muted">{t('askAnowa.backToFarm')}</span>
        </span>
      </Link>
    </div>
  )
}

function Drawer({ onClose, children }) {
  const t = useT()
  const ref = useDialogA11y({ open: true, onClose })
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label={t('askAnowa.closeMenu')} onClick={onClose} className="absolute inset-0 bg-[var(--backdrop)]" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t('askAnowa.railLabel')}
        className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] border-r border-line bg-bg"
      >
        {children}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('askAnowa.closeMenu')}
          className={`absolute right-3 top-3 flex size-8 items-center justify-center rounded-pill text-muted hover:text-text ${FOCUS}`}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/* ─── Top bar: WhatsApp link and model chip (47b) ──────────────────────── */

function TopBar({ t, onMenu, menuOpen, setMenuOpen, catalog, catalogError, choice, setChoice }) {
  const { user } = useAuth()
  const channels = useOptionalQuery(api.bot.bindings.myChannels, user && !user.actingAs ? {} : 'skip', null)
  const whatsapp = channels?.whatsapp?.configured === true
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex w-[180px] shrink-0 items-center">
        <button
          type="button"
          onClick={onMenu}
          aria-label={t('askAnowa.openMenu')}
          className={`flex size-9 items-center justify-center rounded-pill text-muted hover:text-text lg:hidden ${FOCUS}`}
        >
          <Menu size={18} aria-hidden />
        </button>
      </div>
      {whatsapp ? (
        <Link
          href="/account#chat-channels-title"
          className={`hidden items-center gap-2 rounded-pill px-2 py-1 text-[14px] leading-[18px] text-muted hover:text-text sm:flex ${FOCUS}`}
        >
          <MessageCircle size={16} strokeWidth={1.7} aria-hidden />
          {t('askAnowa.whatsapp')}
        </Link>
      ) : (
        <span />
      )}
      <div className="relative flex w-[180px] shrink-0 justify-end">
        <ModelChip t={t} open={menuOpen} setOpen={setMenuOpen} catalog={catalog} catalogError={catalogError} choice={choice} setChoice={setChoice} />
      </div>
    </div>
  )
}

function ModelChip({ t, open, setOpen, catalog, catalogError, choice, setChoice }) {
  const groups = useMemo(() => modelMenu(catalog), [catalog])
  const boxRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, setOpen])

  const name = choice !== AUTO && choice?.model ? choice.model : t('askAnowa.auto')
  const ready = !!catalog && groups.length > 0
  const dot = catalogError || (catalog && groups.length === 0) ? 'bg-alert' : catalog ? 'bg-good' : 'bg-faint'
  const pick = (c) => {
    setChoice(c)
    setOpen(false)
  }
  const row = (selected) =>
    `flex w-full items-center gap-[10px] rounded-[10px] px-3 text-left ${FOCUS} ${selected ? 'bg-surface-2' : 'hover:bg-surface-2'}`

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('askAnowa.modelMenu')}: ${name}`}
        className={`flex max-w-[180px] items-center gap-2 rounded-pill border border-line-strong px-3 py-[6px] text-xs leading-4 text-muted hover:text-text ${FOCUS}`}
      >
        <span className={`size-[6px] shrink-0 rounded-pill ${dot}`} aria-hidden />
        <span className="truncate">{t('askAnowa.modelChip', { name })}</span>
        <ChevronDown size={10} strokeWidth={1.4} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('askAnowa.modelMenu')}
          className="absolute right-0 top-10 z-40 flex max-h-[70vh] w-[300px] flex-col overflow-y-auto rounded-[16px] border border-line-strong bg-surface p-2 shadow-[var(--shadow-md)]"
        >
          <button type="button" role="menuitemradio" aria-checked={choice === AUTO} onClick={() => pick(AUTO)} className={`${row(choice === AUTO)} py-[10px]`}>
            <span className="flex w-4 shrink-0 justify-center text-cyan">{choice === AUTO && <Check size={14} strokeWidth={2} aria-hidden />}</span>
            <span className="flex flex-col gap-[2px]">
              <span className="text-[13px] font-medium leading-4 text-text">{t('askAnowa.auto')}</span>
              <span className="text-xs leading-4 text-muted">{t('askAnowa.autoHint')}</span>
            </span>
          </button>
          {!catalog && !catalogError && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted" role="status">
              <Loader2 size={14} className="animate-spin" aria-hidden />
              {t('assistantUi.modelsLoading')}
            </p>
          )}
          {catalogError && <p className="px-3 py-3 text-xs text-alert">{t('assistantUi.modelsErrorDetail', { message: catalogError })}</p>}
          {catalog && !ready && <p className="px-3 py-3 text-xs text-muted">{t('assistantUi.noProvider')}</p>}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} className="flex flex-col">
              <p className="px-3 pb-[6px] pt-3 text-[11px] uppercase leading-[14px] tracking-[0.06em] text-faint">
                {t('askAnowa.modelsAvailable', { provider: g.label, count: g.models.length })}
              </p>
              {g.models.map((m) => {
                const selected = choice !== AUTO && choice?.provider === g.id && choice?.model === m.id
                const hint = [m.vision && t('askAnowa.readsPhotos'), m.isDefault && t('askAnowa.defaultHint')].filter(Boolean).join(' · ')
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => pick({ provider: g.id, model: m.id })}
                    title={m.label || m.id}
                    className={`${row(selected)} py-2`}
                  >
                    <span className="flex w-4 shrink-0 justify-center text-cyan">{selected && <Check size={14} strokeWidth={2} aria-hidden />}</span>
                    <span className={`min-w-0 grow basis-0 truncate font-data text-xs leading-4 ${selected ? 'text-text' : 'text-muted'}`}>{m.id}</span>
                    {hint && <span className="shrink-0 text-[11px] leading-[14px] text-faint">{hint}</span>}
                  </button>
                )
              })}
            </div>
          ))}
          <p className="mt-[6px] border-t border-line px-3 pb-[6px] pt-[10px] text-xs leading-[17px] text-faint">{t('askAnowa.liveNote')}</p>
        </div>
      )}
    </div>
  )
}

/* ─── Composer (artboard 47) ───────────────────────────────────────────── */

const CHIP = `relative flex shrink-0 items-center gap-2 rounded-pill border px-[14px] py-[9px] text-[14px] leading-[18px] ${FOCUS}`

function Composer({ t, input, setInput, send, busy, inputRef, scope, autoFocus = false }) {
  const { deep, setDeep, siteId, setSiteId, days, setDays, locations } = scope
  const siteName = locations.find((l) => (l.id || l._id) === siteId)?.name || t('askAnowa.allSites')
  const grow = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`
  }
  useEffect(() => grow(inputRef.current), [input, inputRef])
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus, inputRef])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      className="flex w-full flex-col gap-[18px] rounded-[24px] border border-line-strong bg-surface pb-[14px] pl-5 pr-4 pt-5 focus-within:border-muted"
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        placeholder={t('askAnowa.placeholder')}
        aria-label={t('askAnowa.inputLabel')}
        aria-describedby="ask-anowa-keys"
        className="max-h-48 min-h-5 w-full resize-none bg-transparent text-base leading-5 text-text placeholder:text-faint focus:outline-none"
      />
      <span id="ask-anowa-keys" className="sr-only">
        {t('askAnowa.keyboardHint')}
      </span>
      <div className="flex items-center gap-[6px]">
        <div className="flex min-w-0 grow basis-0 items-center gap-[6px] overflow-x-auto">
          <button
            type="button"
            aria-pressed={deep}
            onClick={() => setDeep(!deep)}
            className={`${CHIP} ${deep ? 'border-line-strong bg-surface-2 font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            <Search size={16} strokeWidth={1.7} className={deep ? 'text-cyan' : ''} aria-hidden />
            {t('askAnowa.deep')}
          </button>
          <label className={`${CHIP} cursor-pointer border-transparent text-muted hover:text-text`}>
            <MapPin size={16} strokeWidth={1.7} aria-hidden />
            <span className="max-w-[160px] truncate">{siteName}</span>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              aria-label={t('askAnowa.siteLabel')}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="">{t('askAnowa.allSites')}</option>
              {locations.map((l) => (
                <option key={l.id || l._id} value={l.id || l._id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`${CHIP} cursor-pointer border-transparent text-muted hover:text-text`}>
            <Calendar size={16} strokeWidth={1.7} aria-hidden />
            <span>{t(`askAnowa.range.d${days}`)}</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label={t('askAnowa.rangeLabel')}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {RANGE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {t(`askAnowa.range.d${d}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={t('askAnowa.send')}
          className={`flex size-10 shrink-0 items-center justify-center rounded-pill bg-button text-button-text disabled:bg-surface-2 disabled:text-faint ${FOCUS}`}
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArrowUp size={16} strokeWidth={1.8} aria-hidden />}
        </button>
      </div>
    </form>
  )
}

/* ─── Suggested questions ──────────────────────────────────────────────── */

function Topics({ t, topic, setTopic, onAsk }) {
  const tabRefs = useRef({})
  const onKey = (e, i) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = TOPICS[(i + step + TOPICS.length) % TOPICS.length]
    setTopic(next)
    tabRefs.current[next]?.focus()
  }
  return (
    <section aria-label={t('askAnowa.topicsLabel')} className="flex w-full max-w-[820px] flex-col gap-5 pt-11">
      <div role="tablist" aria-label={t('askAnowa.topicsLabel')} className="flex gap-1 overflow-x-auto">
        {TOPICS.map((k, i) => (
          <button
            key={k}
            ref={(el) => {
              tabRefs.current[k] = el
            }}
            type="button"
            role="tab"
            id={`ask-topic-${k}`}
            aria-selected={topic === k}
            aria-controls="ask-topic-panel"
            tabIndex={topic === k ? 0 : -1}
            onClick={() => setTopic(k)}
            onKeyDown={(e) => onKey(e, i)}
            className={`shrink-0 rounded-[12px] border px-[22px] py-[10px] text-[15px] font-medium leading-[18px] ${FOCUS} ${
              topic === k ? 'border-line bg-surface-2 text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t(`askAnowa.topics.${k}.label`)}
          </button>
        ))}
      </div>
      <div id="ask-topic-panel" role="tabpanel" aria-labelledby={`ask-topic-${topic}`} className="grid grid-cols-1 gap-x-4 gap-y-[6px] sm:grid-cols-3">
        {topicColumns(topic).map((col, ci) => (
          <ul key={ci} className="flex flex-col gap-[6px]">
            {col.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onAsk(t(key))}
                  className={`flex w-full items-center gap-3 rounded-[10px] px-[6px] py-2 text-left text-[15px] leading-[18px] text-text hover:bg-surface ${FOCUS}`}
                >
                  <CornerDownRight size={18} strokeWidth={1.7} className="shrink-0 text-faint" aria-hidden />
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  )
}

/* ─── "Answers use …" strip ────────────────────────────────────────────── */

function Sources({ t, days, siteId, className = '' }) {
  const { locale } = useLocale()
  const asOf = localToday()
  const data = useOptionalQuery(
    api.assistant.sources,
    { asOf, days, ...(siteId ? { locationId: siteId } : {}) },
    null,
  )
  if (!data) return <div className={`h-4 ${className}`} aria-hidden />
  const parts = [
    ['dailyRecords', 'daily'],
    ['samplings', 'samplings'],
    ['waterReadings', 'water'],
    ['sales', 'sales'],
  ]
    .map(([field, label]) => ({ label, value: formatSourceCount(data[field], locale) }))
    .filter((p) => p.value !== null)
  return (
    <p className={`flex w-full max-w-[820px] flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[13px] leading-4 ${className}`}>
      <span className="text-faint">{t('askAnowa.answersUse')}</span>
      {parts.map((p) => (
        <span key={p.label} className="flex items-center gap-[6px]">
          <span className="font-data text-text">{p.value}</span>
          <span className="text-muted">{t(`askAnowa.sources.${p.label}`)}</span>
        </span>
      ))}
      <span className="text-faint">{t('askAnowa.onlyYourRole')}</span>
    </p>
  )
}

/* ─── Saved answers ────────────────────────────────────────────────────── */

function SaveButton({ t, message, onToggle }) {
  const Icon = message.pinned ? BookmarkCheck : Bookmark
  return (
    <div className="mt-2 flex">
      <button
        type="button"
        onClick={() => onToggle(message)}
        aria-pressed={message.pinned}
        className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-xs leading-4 ${message.pinned ? 'text-cyan' : 'text-muted hover:text-text'} ${FOCUS}`}
      >
        <Icon size={14} aria-hidden />
        {message.pinned ? t('askAnowa.savedBadge') : t('askAnowa.saveAnswer')}
        {message.pinned && <span className="sr-only"> · {t('askAnowa.unsaveAnswer')}</span>}
      </button>
    </div>
  )
}

function SavedAnswers({ t, onOpen }) {
  const rows = useOptionalQuery(api.assistantChats.saved, {}, [])
  const setPinned = useMutation(api.assistantChats.setPinned)
  return (
    <section aria-labelledby="ask-saved-title" className="flex w-full max-w-[820px] grow basis-0 flex-col gap-5 overflow-y-auto pt-8">
      <h1 id="ask-saved-title" className="font-serif text-[40px] font-normal leading-[44px] tracking-[-0.02em] text-text">
        {t('askAnowa.savedTitle')}
      </h1>
      {rows === undefined ? (
        <div className="h-32 animate-pulse rounded-card bg-surface" />
      ) : rows.length === 0 ? (
        <p className="text-[15px] leading-6 text-muted">{t('askAnowa.savedEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r._id} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              <p className="text-xs leading-4 text-faint">{r.chatTitle}</p>
              <p className="whitespace-pre-wrap text-[15px] leading-6 text-text">{r.content}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(r.chatId)}
                  className={`rounded-pill border border-line-strong px-[14px] py-2 text-[13px] leading-4 text-text hover:bg-surface-2 ${FOCUS}`}
                >
                  {t('askAnowa.openConversation')}
                </button>
                <button
                  type="button"
                  onClick={() => setPinned({ messageId: r._id, pinned: false })}
                  className={`inline-flex items-center gap-1.5 rounded-pill px-[14px] py-2 text-[13px] leading-4 text-muted hover:text-text ${FOCUS}`}
                >
                  <BookmarkCheck size={14} aria-hidden />
                  {t('askAnowa.unsaveAnswer')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
