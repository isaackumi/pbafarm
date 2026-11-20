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

/** True when the text reads like a request to create an automation. */
export function isAutomationRequest(text) {
  const t = String(text || '').trim()
  if (t.length < 8) return false
  // Questions about the data ("why did DO drop?") are not requests to automate.
  if (/^(what|why|how much|how many|which|who|show|list|summari[sz]e|compare)\b/i.test(t) && !/\b(alert|remind|notify|automat)/i.test(t)) {
    return false
  }
  return PATTERNS.some((re) => re.test(t))
}
