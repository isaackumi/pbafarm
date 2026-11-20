// lib/anowaIntent.js — does a message ask Anowa to set up an automation?
//
// Pure and cheap: it runs on every message in the assistant. It only routes
// the message to the automation-draft endpoint; the draft is always shown for
// review and nothing is created without a click.

const PATTERNS = [
  /\bautomat(e|ion|ions|ically)\b/i,
  /\b(alert|notify|text|sms|whatsapp|email|message|ping|warn|tell)\s+(me|us|the\s+\w+|all|everyone|admins?|managers?|supervisors?|feeders?|staff)\b.*\b(when|if|whenever|every|each|once|as soon as)\b/i,
  /\b(when|whenever|if|as soon as)\b.*\b(alert|notify|text|remind|warn|tell|send)\b/i,
  /\bremind\s+(me|us|the|all|everyone|admins?|managers?|staff)\b/i,
  /\b(every|each)\s+(day|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?\s*(am|pm)?)\b.*\b(send|alert|notify|remind|check|create|text|tell)\b/i,
  /\b(send|alert|notify|remind|check|create|text|tell)\b.*\b(every|each)\s+(day|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(create|set up|setup|add|make)\s+(an?\s+)?(rule|alert|reminder|workflow|automation)\b/i,
  // French (the UI ships EN + FR).
  /\bautomatis(er|ation|ations|e|ez)\b/i,
  /\b(alerte[rz]?|pr[ée]vien[st]?|pr[ée]venir|notifie[rz]?|rappelle[rz]?|envoie[rz]?)\b.*\b(quand|si|lorsque|d[èe]s que|chaque|tous les)\b/i,
  /\b(chaque|tous les)\s+(jours?|matins?|soirs?|semaines?|lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)\b/i,
  /\b(cr[ée]er|ajouter)\s+(une?\s+)?(r[èe]gle|alerte|rappel|automatisation)\b/i,
]

/** Scheduling a saved report ("email the weekly report every Monday"): a report schedule draft, not an automation. */
const REPORT_SCHEDULE = /\b(schedule|email|send|programme[rz]?|envoie[rz]?|planifie[rz]?)\b.*\b(reports?|rapports?)\b/i

/** True when the text reads like a request to create an automation. */
export function isAutomationRequest(text) {
  const t = String(text || '').trim()
  if (t.length < 8) return false
  if (REPORT_SCHEDULE.test(t)) return false
  // Questions about the data ("why did DO drop?") are not requests to automate.
  if (/^(what|why|how much|how many|which|who|show|list|summari[sz]e|compare)\b/i.test(t) && !/\b(alert|remind|notify|automat)/i.test(t)) {
    return false
  }
  return PATTERNS.some((re) => re.test(t))
}

// Ask Anowa "does it for you" (spec 2026-11-20 §2): a request to record,
// order, issue or assign something goes to the agent with tools, which only
// drafts; the member confirms the card. Questions stay on the answer route.
const ACTION_PATTERNS = [
  /\b(record|log|enter|add|save|note)\b.*\b(dead|deaths?|mortalit(y|ies)|morts?|feed|fed|kg|entry|entries)\b/i,
  /\b\d+\s*(dead|deaths?|morts?)\b/i,
  /\b(fed|feed(ing)?)\s+\d+(\.\d+)?\s*(kg|bags?)\b/i,
  /\b(order|buy|purchase|reorder|restock)\b.*\b(feed|bags?|pellets?|kg)\b/i,
  /\b(issue|give out|take out)\b.*\b(feed|kg|bags?)\b/i,
  /\b(assign|create|add|schedule)\b.*\b(task|job|check)\b/i,
  /\b(remind|ask)\s+\w+\s+to\b/i,
  // French.
  /\b(enregistre[rz]?|note[rz]?|saisi[rs]?|ajoute[rz]?)\b.*\b(morts?|mortalit[ée]s?|aliment|kg|entr[ée]e)\b/i,
  /\b\d+\s*morts?\b/i,
  /\b(command(e|er|ez)|ach[eè]te[rz]?|r[ée]approvisionne[rz]?)\b.*\b(aliment|sacs?|kg)\b/i,
  /\b(sors|sortir|distribue[rz]?)\b.*\b(aliment|kg|sacs?)\b/i,
  /\b(assigne[rz]?|cr[ée]e[rz]?|planifie[rz]?)\b.*\b(t[âa]che|contr[ôo]le)\b/i,
  // Cage keepers: give units or a row to someone, cover, rebalance, nudge.
  /\b(give|hand|assign|move)\b.*\b(row|cages?|units?|ponds?|tanks?|[a-z]-?\d+)\b.*\bto\b/i,
  /\b(is|are|will be)\s+(away|off|on leave)\b/i,
  /\b(cover|covers|covering)\s+(for\s+)?\w+/i,
  /\b(re-?balance|auto-?balance)\b/i,
  /\bnudge\b/i,
  /\b(donne[rz]?|confie[rz]?|attribue[rz]?)\b.*\b(rang[ée]e|cages?|unit[ée]s?)\b/i,
  /\b(est|sont|sera|seront)\s+(absent|absente|absents|en cong[ée])\b/i,
  /\b(r[ée][ée]quilibre[rz]?)\b/i,
  /\brelance[rz]?\b.*\b(gardiens?|soigneurs?|[ée]quipe)\b/i,
  // Farm records drafted through the tools (sampling, water, harvest, stocking, transfer, sale, approval, plan).
  /\b(record|log|enter|add|save)\b.*\b(sampl\w*|abw|water|oxygen|DO|temperature|ph|ammonia|reading|harvest|sale|stocking|transfer)\b/i,
  /\bsample\b.*\b\d+\s*(fish|g)\b/i,
  /\b\d+\s*fish\s+at\s+\d+(\.\d+)?\s*g\b/i,
  /\bharvest(ed)?\b.*\b\d+(\.\d+)?\s*(kg|t|tonnes?|tons?)\b/i,
  /\bstock\b.*\b\d[\d,.]*\s*k?\s*(fish|fingerlings?)\b/i,
  /\b(transfer|move)\b.*\b\d[\d,]*\s*fish\b/i,
  /\brequest an?\s+(transfer|stocking)\b/i,
  /\b(sell|sold)\b.*\b\d+(\.\d+)?\s*(kg|t)\b/i,
  /\b(record|draft|issue|raise)\b.*\b(sales?|invoices?)\b/i,
  /\b(approve|reject|decline)\b/i,
  /\b(plan|draft)\b.*\bcycle\b/i,
  /\blook ?up\b.*\blot\b/i,
  /\b(enregistre[rz]?|saisi[rs]?|note[rz]?)\b.*\b([ée]chantillonnage|pmi|eau|oxyg[èe]ne|r[ée]colte|vente|empoissonnement|transfert)\b/i,
  /\b(approuve[rz]?|rejette[rz]?|refuse[rz]?)\b/i,
  /\bdemande[rz]?\b.*\b(transfert|empoissonnement)\b/i,
  /\b([ée]mett(re|s|ez)|[ée]tabli[rs])\b.*\bfacture\b/i,
  /\bplanifie[rz]?\b.*\bcycle\b/i,
  /\brecherche[rz]?\b.*\blot\b/i,
]

/** Questions answered from live records by the tools agent (forecast, water, money, approvals, lots, …). */
const TOOL_QUESTIONS = [
  /\bwhen will\b.*\b(reach|hit|get to|be ready)\b/i,
  /\b(reach|reaches)\b.*\b(target|harvest weight|\d+\s*g)\b/i,
  /\bharvest (plan|planner|forecast)\b/i,
  /\b(abw|growth)\s+(trend|history)\b|\bsampling (history|trend)\b|\blast samplings?\b/i,
  /\blow[- ]?(do|oxygen)\b|\boxygen events?\b|\bwater quality\b|\b(DO|dissolved oxygen)\b.*\btrend\b/i,
  /\b(outstanding|unpaid|overdue)\b.*\b(invoices?|sales|receivables?|money)\b/i,
  /\bp\s*&\s*l\b|\bprofit\b|\brevenue\b|\bcost per kg\b/i,
  /\b(waiting|pending)\b.*\bapprov/i,
  /\bmy approval\b/i,
  /\blot\b.*\b(code|trace)\b/i,
  /\b(cycle|saved) plans?\b/i,
  /\b(open|active)\s+(alerts?|alarms?|warnings?)\b|\bsensor alarms?\b/i,
  /\b(stockings?|transfers?|top-?ups?)\b.*\b(this|last|since)\b/i,
  /\b(hatchery|broodstock|spawn(s|ing)?|fry output|larvae)\b/i,
  /\bquand\b.*\batteindr/i,
  /\bplan de r[ée]colte\b/i,
  /\b(tendance|historique)\b.*\b(pmi|croissance|[ée]chantillonnages?)\b/i,
  /\boxyg[èe]ne bas\b|\bqualit[ée] de l'eau\b|\b[ée]pisodes? d'oxyg[èe]ne\b/i,
  /\b(factures?|ventes?)\b.*\b(impay[ée]es?|en retard)\b/i,
  /\bcompte de r[ée]sultat\b|\bb[ée]n[ée]fice\b|\bchiffre d'affaires\b|\bco[ûu]t au kg\b/i,
  /\b(attend|en attente)\b.*\bapprobation\b/i,
  /\bcode de lot\b/i,
  /\bplans? de cycle\b/i,
  /\b(alertes?|alarmes?)\b.*\b(ouvertes?|capteurs?)\b/i,
  /\b(empoissonnements?|transferts?)\b.*\b(ce|cette|derni\w*|depuis)\b/i,
  /\b([ée]closerie|g[ée]niteurs|pontes?|alevins)\b/i,
]

/** Keeper questions answered from live data by the tools agent ("who is behind today?"). */
const KEEPER_QUESTIONS = [
  /\bwho\b.*\b(is|are)\s+behind\b/i,
  /\bwho\s+(keeps|looks after|is the keeper)\b/i,
  /\bqui\b.*\ben retard\b/i,
  /\bqui\s+(garde|s'occupe)\b/i,
]

/**
 * True when the text should go to the agent with tools: a request to record,
 * order, issue, approve or schedule something (drafted, never saved), or a
 * question the live read tools answer (forecast, water, money, approvals).
 */
export function isActionRequest(text) {
  const t = String(text || '').trim()
  if (t.length < 6) return false
  if (REPORT_SCHEDULE.test(t)) return true
  if (isAutomationRequest(t)) return false
  if (KEEPER_QUESTIONS.some((re) => re.test(t))) return true
  if (TOOL_QUESTIONS.some((re) => re.test(t))) return true
  if (/^(what|why|how|which|who|when|show|list|summari[sz]e|compare|should|is|are|did|does|do|pourquoi|comment|quel|quelle|combien)\b/i.test(t)) {
    return false
  }
  return ACTION_PATTERNS.some((re) => re.test(t))
}
