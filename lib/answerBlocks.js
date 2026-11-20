/**
 * The light Markdown Anowa is told to write (lib/anowaPersona ANOWA_FORMAT),
 * parsed into plain blocks for components/AnswerText: headings, paragraphs,
 * bullet and numbered lists, with **bold**, *italic* and `code` spans. No
 * HTML, links or images exist in this grammar, so rendering it with React
 * elements cannot inject markup. Anything else stays text.
 */

/** Inline spans: [{ kind: 'text' | 'bold' | 'italic' | 'code', text }]. */
export function parseInline(text) {
  const out = []
  const re = /(\*\*|__)(.+?)\1|`([^`]+)`|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] })
    else if (m[3] !== undefined) out.push({ kind: 'code', text: m[3] })
    else out.push({ kind: 'italic', text: m[4] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/

/**
 * Blocks: { type: 'heading' | 'paragraph', spans } or
 * { type: 'ul' | 'ol', items: spans[], start? }.
 */
export function parseAnswer(text) {
  const blocks = []
  let para = []
  let list = null
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', spans: parseInline(para.join('\n')) })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const h = HEADING.exec(line)
    const b = BULLET.exec(line)
    const n = NUMBERED.exec(line)
    if (h) {
      flushPara()
      flushList()
      blocks.push({ type: 'heading', spans: parseInline(h[1]) })
    } else if (b || n) {
      flushPara()
      const type = b ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [], ...(n ? { start: Number(n[1]) } : {}) }
      }
      list.items.push(parseInline(b ? b[1] : n[2]))
    } else if (list && /^\s{2,}\S/.test(line)) {
      // Continuation of the previous list item.
      const items = list.items
      items[items.length - 1] = [...items[items.length - 1], { kind: 'text', text: ` ${line.trim()}` }]
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()
  return blocks
}
