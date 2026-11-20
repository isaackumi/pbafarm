import { useState } from 'react'
import { useAction } from 'convex/react'
import { ArrowUp, Loader2, MessageCircle } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import DraftCard from '../AnowaDraftCard'
import AnswerText from '../AnswerText'
import { useLocale, useT } from '../../lib/i18n/context'
import { assistantErrorText } from '../../lib/assistantErrors'
import { clock } from '../../lib/keepers'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'

/**
 * Anowa's brief on the keeper board (Paper 57): what needs the manager, each
 * with a one-tap fix that drafts the change (the card confirms it), and the
 * ask-or-tell bar, which goes to Ask Anowa's tools agent ("give Kpong row D
 * to Yaw", "who is behind today?").
 */
export default function AnowaBrief({ board, onFix, canAsk }) {
  const t = useT()
  const { formatLocale, locale } = useLocale()
  const lang = formatLocale || locale
  const b = board?.brief
  const items = []
  if (b?.none.units) {
    items.push({
      key: 'none',
      tone: 'text-alert',
      lead: t('keepers.brief.noneLead', { count: b.none.units }),
      text:
        b.none.site && b.none.groupUnits === b.none.units
          ? t('keepers.brief.noneAt', { site: b.none.site, row: b.none.row || '' })
          : t('keepers.brief.noneSpread'),
      action: b.none.suggest.length ? t('keepers.brief.noneFix', { names: b.none.suggest.map((k) => k.name).join(t('keepers.brief.and')) }) : t('keepers.brief.noneFixAny'),
    })
  }
  if (b?.over.keepers) {
    items.push({
      key: 'over',
      tone: 'text-warn',
      lead: t('keepers.brief.overLead', { count: b.over.keepers }),
      text: t('keepers.brief.overText', { capacity: board.capacity }),
      action: t('keepers.brief.overFix', { count: b.over.units }),
    })
  }
  if (b?.due.units) {
    items.push({
      key: 'due',
      tone: 'text-warn',
      lead: t('keepers.brief.dueLead', { count: b.due.units }),
      text: b.due.site ? t('keepers.brief.dueAt', { deadline: board.deadline, site: b.due.site }) : t('keepers.brief.dueText', { deadline: board.deadline }),
      action: t('keepers.brief.dueFix'),
    })
  }
  if (b?.away.keepers) {
    items.push({
      key: 'away',
      tone: 'text-cover',
      lead: t('keepers.brief.awayLead', { count: b.away.keepers }),
      text: t('keepers.brief.awayText'),
      action: t('keepers.brief.awayFix'),
    })
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-[20px] border border-line-strong bg-surface px-5 py-[18px]" aria-label={t('keepers.brief.label')}>
      <div className="flex items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-lime font-geist text-[13px] font-semibold text-ink" aria-hidden>
          a
        </span>
        <h2 className="text-[15px] font-semibold leading-5 text-text">
          {board === undefined ? t('keepers.loading') : items.length ? t('keepers.brief.title', { count: items.length }) : t('keepers.brief.allGood')}
        </h2>
        <span className="ml-auto shrink-0 text-xs leading-4 text-faint">{board ? t('keepers.brief.updated', { time: clock(Date.now(), lang) }) : ''}</span>
      </div>
      {items.length > 0 && (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((it) => (
            <li key={it.key} className="flex flex-col gap-2 rounded-[14px] border border-line bg-bg px-3.5 py-3">
              <p className="text-[13px] leading-[18px] text-muted">
                <span className={`font-semibold ${it.tone}`}>{it.lead}</span> {it.text}
              </p>
              <button type="button" onClick={() => onFix(it.key)} className={`mt-auto self-start text-left text-[13px] font-semibold leading-4 text-cover hover:underline ${FOCUS}`}>
                {it.action}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canAsk && <AskBar />}
    </section>
  )
}

function AskBar() {
  const t = useT()
  const { locale } = useLocale()
  const ask = useAction(api.anowa.agent.ask)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState(null)

  const send = async (e) => {
    e.preventDefault()
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setAnswer(null)
    try {
      const res = await ask({ question, lang: locale })
      if (!res.ok) throw Object.assign(new Error(''), { code: res.code, retryAfterSec: res.retryAfterSec })
      setAnswer({ text: res.text, draftGroup: res.draftGroup })
      setQ('')
    } catch (err) {
      setAnswer({ text: assistantErrorText(t, err), failed: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={send} className="flex h-11 items-center gap-2.5 rounded-pill border border-line-strong bg-bg pl-4 pr-1.5 focus-within:border-text/40">
        <MessageCircle size={16} className="shrink-0 text-faint" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('keepers.brief.askPlaceholder')}
          aria-label={t('keepers.brief.askLabel')}
          maxLength={2000}
          className="min-w-0 grow border-0 bg-transparent p-0 text-[13px] text-text placeholder:text-faint focus:outline-none focus:ring-0"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          aria-label={t('keepers.brief.askSend')}
          className={`flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-surface-2 text-text disabled:opacity-50 ${FOCUS}`}
        >
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ArrowUp size={14} aria-hidden />}
        </button>
      </form>
      {answer && (
        <div className={`rounded-[14px] border border-line bg-bg px-4 py-3 text-sm ${answer.failed ? 'text-muted' : 'text-text'}`} role="status">
          <AnswerText text={answer.text} compact />
          {answer.draftGroup && <DraftCard draftGroup={answer.draftGroup} />}
        </div>
      )}
    </div>
  )
}
