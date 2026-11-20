import { Fragment, useMemo } from 'react'
import { parseAnswer } from '../lib/answerBlocks'

/**
 * An Anowa answer: the light Markdown it writes (bold, bullets, steps, short
 * headings) as React elements. Text only, never HTML (OWASP LLM05); the
 * server already stripped links, images and markup (convex/lib/llmAnswer).
 */
function Spans({ spans }) {
  return spans.map((s, i) => {
    if (s.kind === 'bold') return <strong key={i} className="font-semibold text-text">{s.text}</strong>
    if (s.kind === 'italic') return <em key={i}>{s.text}</em>
    if (s.kind === 'code') {
      return (
        <code key={i} className="rounded-[6px] bg-surface-2 px-1 py-0.5 font-data text-[0.9em]">
          {s.text}
        </code>
      )
    }
    return <Fragment key={i}>{s.text}</Fragment>
  })
}

export default function AnswerText({ text, compact = false }) {
  const blocks = useMemo(() => parseAnswer(text), [text])
  const gap = compact ? 'gap-2' : 'gap-3'
  return (
    <div className={`flex flex-col ${gap} whitespace-pre-line`}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <p key={i} className="pt-1 font-semibold text-text">
              <Spans spans={b.spans} />
            </p>
          )
        }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type
          return (
            <List
              key={i}
              start={b.start}
              className={`flex flex-col gap-1 pl-5 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-faint`}
            >
              {b.items.map((spans, j) => (
                <li key={j}>
                  <Spans spans={spans} />
                </li>
              ))}
            </List>
          )
        }
        return (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        )
      })}
    </div>
  )
}
