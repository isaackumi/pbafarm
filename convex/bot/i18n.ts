/**
 * Farm bot replies in English and French (doc 23 §7). The language is the
 * user's account locale; before binding, Telegram's language hint or English.
 */
export type BotLocale = 'en' | 'fr'

export function botLocale(value: string | undefined | null): BotLocale {
  return value && value.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

const en = {
  onboarding: (appUrl: string) =>
    `Hello! This is the Anowa assistant. To use it, open ${appUrl}/account, choose "Connect WhatsApp / Telegram" and follow the steps.`,
  linkHowTo: 'Send the 6-digit code from your account page like this: LINK 123456',
  linkBadCode: 'That code is not valid or has expired. Create a new one on your account page.',
  linkPhoneMismatch:
    'This WhatsApp number is not the verified phone on any account. Verify this number on your account page first, then create a code.',
  linked: (name: string, company: string) => `Connected, ${name}. You are working in ${company}.`,
  noOrg: 'Your account has no active organization. Ask your administrator.',
  bindingInactive: 'This chat is no longer connected to an active account. Connect again from your account page.',
  rateLimited: 'Too many messages. Please wait a minute and try again.',
  chooseCompany: 'Which organization do you want to work in?',
  chooseSite: 'Which site do you want to work in?',
  pick: 'Choose',
  siteSet: (site: string) => `Active site: ${site}.`,
  companySet: (company: string) => `Active organization: ${company}.`,
  allSites: 'All sites',
  unsupported: 'I can read text messages, voice notes and logbook photos.',
  aiDisabled:
    'The assistant is not enabled for your organization, so I can only take buttons and commands (HELP). An administrator can enable it in Settings → AI.',
  aiUnavailable: 'The assistant is not available right now. Please try again later.',
  aiQuota: (retry: string) => `You have used the assistant a lot recently. ${retry}`,
  help:
    'Tell me what happened today, e.g. "Cage A3: fed 25 kg, 2 dead". I will show a summary to Save or Cancel. Ask "what is missing today?" or "feed stock". Commands: SITE (change site), ORG (change organization), STOP (disconnect), HELP.',
  save: 'Save',
  saveAnyway: 'Save anyway',
  edit: 'Edit',
  cancel: 'Cancel',
  undo: 'Undo',
  confirmPrompt: 'Save this?',
  duplicateWarning: 'A similar entry was sent a few minutes ago.',
  saved: 'Saved.',
  savedUndo: (mins: number) => `Saved. You can undo for ${mins} minutes.`,
  alreadySaved: 'This entry was already saved.',
  cancelled: 'Cancelled. Nothing was saved.',
  editPrompt: 'OK, send the corrected entry.',
  expired: 'This draft has expired. Send the entry again.',
  notPending: 'This draft is no longer open.',
  undone: 'Undone. The entry was removed.',
  undoTooLate: 'It is too late to undo here. Correct the entry in the app.',
  commitFailed: (msg: string) => `Not saved: ${msg}`,
  disconnected: 'Disconnected. You can connect again from your account page.',
  reminderBody: (count: number, units: string) =>
    count === 1 ? `1 unit has no entry today: ${units}` : `${count} units have no entry today: ${units}`,
  reminderAllDone: 'All units have today\'s entry. Well done!',
  enterNow: 'Enter now',
  remindLater: 'Later',
  stopReminders: 'Stop reminders',
  remindersStopped: 'Daily reminders are off. Turn them on again from your account page.',
  laterOk: 'OK, I will not remind you again today.',
  summaryDaily: (p: { unit: string; date: string; feed: string; mortality: number; notes?: string }) =>
    `${p.unit}, ${p.date}: feed ${p.feed}, mortality ${p.mortality}${p.notes ? `, notes: ${p.notes}` : ''}`,
  summaryIssue: (p: { qty: number; feedType: string; unit?: string; date: string }) =>
    `Feed issue ${p.date}: ${p.qty} kg ${p.feedType}${p.unit ? ` to ${p.unit}` : ''}`,
  approvalKinds: { stocking: 'Stocking', topup: 'Top-up', transfer: 'Fish transfer' } as Record<
    'stocking' | 'topup' | 'transfer',
    string
  >,
  approvalNeeded: (label: string, who: string, subject: string) => `${label} needs your approval.\n${who}: ${subject}.`,
  approve: 'Approve',
  reject: 'Reject',
  approvedDone: (subject: string) => `Approved: ${subject}.`,
  rejectedDone: (subject: string) => `Rejected: ${subject}.`,
  approvalAlready: (decision: 'approved' | 'rejected' | 'closed', by: string) =>
    decision === 'closed'
      ? 'This request is no longer pending.'
      : `This request was already ${decision}${by ? ` by ${by}` : ''}.`,
  approvalYouDecided: (decision: 'approved' | 'rejected') => `You already ${decision} this request.`,
  approvalExpired: 'These buttons have expired. Open Approvals in the app to decide.',
  approvalGone: 'This request no longer exists.',
  approvalNotAllowed: 'You cannot approve this request.',
  approvalFailed: (msg: string) => `Not done: ${msg}`,
  rejectReasonPrompt: 'Why are you rejecting it? Pick a reason or type it. Send CANCEL to leave it pending.',
  rejectReasonPick: 'Reason',
  rejectKept: 'OK, the request is still pending.',
  rejectReasons: {
    count: 'Wrong fish count',
    unit: 'Wrong unit',
    date: 'Wrong date',
    weight: 'Wrong weight (ABW)',
    plan: 'Not in the plan',
  } as Record<'count' | 'unit' | 'date' | 'weight' | 'plan', string>,
  // Voice notes (BOT-005, artboard 49)
  languageNames: { en: 'English', fr: 'French', tw: 'Twi', ee: 'Ewe', gaa: 'Ga' } as Record<
    'en' | 'fr' | 'tw' | 'ee' | 'gaa',
    string
  >,
  voiceNotSetUp: (lang: string) =>
    `Voice notes in ${lang} are not set up yet. Please type the entry instead, e.g. "Cage A3: fed 25 kg, 2 dead".`,
  voiceTooLarge: (mb: number) => `This voice note is too long (over ${mb} MB). Please send a shorter one.`,
  voiceBadType: 'I could not play this voice note. Please record it again in WhatsApp or Telegram.',
  voiceDownloadFailed: 'I could not download the voice note. Please send it again.',
  voiceUnavailable: 'I could not listen to the voice note right now. Please try again later or type the entry.',
  voiceEmpty: 'I could not hear anything in that voice note. Please try again closer to the phone.',
  voiceNoPermission: 'Your role cannot record daily entries, so I cannot take voice notes from you.',
  heardIn: (lang: string, translated: boolean) => (translated ? `Heard in ${lang} · English` : `Heard in ${lang}`),
  heardCount: (n: number, cages: boolean) =>
    `Got it. I heard ${n} ${cages ? (n === 1 ? 'cage' : 'cages') : n === 1 ? 'entry' : 'entries'}. Please check before I save:`,
  fieldUnit: 'Unit',
  fieldFeed: 'Feed',
  fieldMortality: 'Mortality',
  fieldIssue: 'Feed issue',
  fish: (n: number) => `${n} fish`,
  notSaid: 'Not said, saved as 0',
  check: 'CHECK',
  checkNote: (heard: string | undefined, value: string, unit: string) =>
    heard
      ? `I heard "${heard}" (${value}) for ${unit} but the line was noisy. Tap Edit if that's wrong.`
      : `I am not sure of ${value} for ${unit}. Tap Edit if that's wrong.`,
  savingFor: (date: string, isToday: boolean) => (isToday ? `Saving for today, ${date}.` : `Saving for ${date}.`),
  saveGroup: (n: number) => (n === 1 ? 'Save' : n === 2 ? 'Save both' : `Save all ${n}`),
  whichCage: (what: string | null) =>
    what ? `I didn't catch the cage clearly. Which one had ${what}?` : "I didn't catch the cage clearly. Which one was it?",
  whatDead: (n: number) => (n === 1 ? '1 dead fish' : `${n} dead fish`),
  whatFeed: (kg: string) => `${kg} of feed`,
  another: 'Another',
  pickFromList: 'Which cage? If it is not here, tap Cancel and send the note again with the cage name.',
  cagePicked: (name: string) => `OK, ${name}.`,
  pickCageFirst: 'Pick the cage first, then tap Save.',
  voiceSaved: (names: string, mins: number) => `Saved ${names}. You can undo for ${mins} minutes.`,
  voiceUndoAll: (n: number) => (n === 1 ? 'Undone. The entry was removed.' : `Undone. ${n} entries were removed.`),
  voiceLanguageSet: (lang: string) => `Voice notes: I will listen for ${lang}.`,
  voiceLanguageHelp: 'Send VOICE TWI, VOICE EWE, VOICE GA, VOICE EN or VOICE FR to set the language of your voice notes.',
}

type Strings = typeof en

const fr: Strings = {
  onboarding: (appUrl: string) =>
    `Bonjour ! Ici l'assistant Anowa. Pour l'utiliser, ouvrez ${appUrl}/account, choisissez « Connecter WhatsApp / Telegram » et suivez les étapes.`,
  linkHowTo: 'Envoyez le code à 6 chiffres de votre page compte ainsi : LINK 123456',
  linkBadCode: "Ce code n'est pas valide ou a expiré. Créez-en un nouveau sur votre page compte.",
  linkPhoneMismatch:
    "Ce numéro WhatsApp n'est le téléphone vérifié d'aucun compte. Vérifiez d'abord ce numéro sur votre page compte, puis créez un code.",
  linked: (name: string, company: string) => `Connecté, ${name}. Vous travaillez dans ${company}.`,
  noOrg: "Votre compte n'a pas d'organisation active. Contactez votre administrateur.",
  bindingInactive: "Ce chat n'est plus relié à un compte actif. Reconnectez-vous depuis votre page compte.",
  rateLimited: 'Trop de messages. Attendez une minute puis réessayez.',
  chooseCompany: 'Dans quelle organisation voulez-vous travailler ?',
  chooseSite: 'Sur quel site voulez-vous travailler ?',
  pick: 'Choisir',
  siteSet: (site: string) => `Site actif : ${site}.`,
  companySet: (company: string) => `Organisation active : ${company}.`,
  allSites: 'Tous les sites',
  unsupported: 'Je lis les messages texte, les notes vocales et les photos du cahier.',
  aiDisabled:
    "L'assistant n'est pas activé pour votre organisation : je ne traite que les boutons et les commandes (AIDE). Un administrateur peut l'activer dans Paramètres → IA.",
  aiUnavailable: "L'assistant n'est pas disponible pour le moment. Réessayez plus tard.",
  aiQuota: (retry: string) => `Vous avez beaucoup utilisé l'assistant récemment. ${retry}`,
  help:
    "Dites-moi ce qui s'est passé aujourd'hui, par ex. « Cage A3 : 25 kg d'aliment, 2 morts ». Je vous montre un résumé à Enregistrer ou Annuler. Demandez « qu'est-ce qui manque aujourd'hui ? » ou « stock d'aliment ». Commandes : SITE, ORG, STOP (déconnecter), AIDE.",
  save: 'Enregistrer',
  saveAnyway: 'Enregistrer quand même',
  edit: 'Modifier',
  cancel: 'Annuler',
  undo: 'Annuler la saisie',
  confirmPrompt: 'Enregistrer ?',
  duplicateWarning: 'Une saisie semblable a été envoyée il y a quelques minutes.',
  saved: 'Enregistré.',
  savedUndo: (mins: number) => `Enregistré. Vous pouvez annuler pendant ${mins} minutes.`,
  alreadySaved: 'Cette saisie est déjà enregistrée.',
  cancelled: "Annulé. Rien n'a été enregistré.",
  editPrompt: 'Entendu, envoyez la saisie corrigée.',
  expired: 'Ce brouillon a expiré. Envoyez la saisie à nouveau.',
  notPending: "Ce brouillon n'est plus ouvert.",
  undone: 'Annulé. La saisie a été supprimée.',
  undoTooLate: "Il est trop tard pour annuler ici. Corrigez la saisie dans l'application.",
  commitFailed: (msg: string) => `Non enregistré : ${msg}`,
  disconnected: 'Déconnecté. Vous pouvez vous reconnecter depuis votre page compte.',
  reminderBody: (count: number, units: string) =>
    count === 1
      ? `1 unité n'a pas de saisie aujourd'hui : ${units}`
      : `${count} unités n'ont pas de saisie aujourd'hui : ${units}`,
  reminderAllDone: "Toutes les unités ont leur saisie du jour. Bravo !",
  enterNow: 'Saisir',
  remindLater: 'Plus tard',
  stopReminders: 'Arrêter les rappels',
  remindersStopped: 'Les rappels quotidiens sont désactivés. Réactivez-les depuis votre page compte.',
  laterOk: "D'accord, je ne vous le rappellerai plus aujourd'hui.",
  summaryDaily: (p) =>
    `${p.unit}, ${p.date} : aliment ${p.feed}, mortalité ${p.mortality}${p.notes ? `, notes : ${p.notes}` : ''}`,
  summaryIssue: (p) => `Sortie d'aliment ${p.date} : ${p.qty} kg ${p.feedType}${p.unit ? ` vers ${p.unit}` : ''}`,
  approvalKinds: { stocking: 'Empoissonnement', topup: 'Complément', transfer: 'Transfert de poissons' },
  approvalNeeded: (label, who, subject) => `${label} : votre approbation est requise.\n${who} : ${subject}.`,
  approve: 'Approuver',
  reject: 'Rejeter',
  approvedDone: (subject) => `Approuvé : ${subject}.`,
  rejectedDone: (subject) => `Rejeté : ${subject}.`,
  approvalAlready: (decision, by) =>
    decision === 'closed'
      ? "Cette demande n'est plus en attente."
      : `Cette demande a déjà été ${decision === 'approved' ? 'approuvée' : 'rejetée'}${by ? ` par ${by}` : ''}.`,
  approvalYouDecided: (decision) => `Vous avez déjà ${decision === 'approved' ? 'approuvé' : 'rejeté'} cette demande.`,
  approvalExpired: "Ces boutons ont expiré. Ouvrez Approbations dans l'application pour décider.",
  approvalGone: "Cette demande n'existe plus.",
  approvalNotAllowed: 'Vous ne pouvez pas approuver cette demande.',
  approvalFailed: (msg) => `Non effectué : ${msg}`,
  rejectReasonPrompt: 'Pourquoi la rejeter ? Choisissez un motif ou écrivez-le. Envoyez ANNULER pour la laisser en attente.',
  rejectReasonPick: 'Motif',
  rejectKept: 'Entendu, la demande reste en attente.',
  rejectReasons: {
    count: 'Nombre de poissons faux',
    unit: 'Mauvaise unité',
    date: 'Mauvaise date',
    weight: 'Poids moyen faux',
    plan: 'Hors planning',
  },
  languageNames: { en: 'anglais', fr: 'français', tw: 'twi', ee: 'éwé', gaa: 'ga' },
  voiceNotSetUp: (lang) =>
    `Les notes vocales en ${lang} ne sont pas encore configurées. Écrivez plutôt la saisie, par ex. « Cage A3 : 25 kg d'aliment, 2 morts ».`,
  voiceTooLarge: (mb) => `Cette note vocale est trop longue (plus de ${mb} Mo). Envoyez-en une plus courte.`,
  voiceBadType: "Je n'arrive pas à lire cette note vocale. Enregistrez-la à nouveau dans WhatsApp ou Telegram.",
  voiceDownloadFailed: "Je n'ai pas pu télécharger la note vocale. Envoyez-la à nouveau.",
  voiceUnavailable: "Je ne peux pas écouter la note vocale pour le moment. Réessayez plus tard ou écrivez la saisie.",
  voiceEmpty: "Je n'ai rien entendu dans cette note vocale. Réessayez plus près du téléphone.",
  voiceNoPermission: 'Votre rôle ne permet pas les saisies quotidiennes, je ne peux donc pas prendre vos notes vocales.',
  heardIn: (lang, translated) => (translated ? `Entendu en ${lang} · anglais` : `Entendu en ${lang}`),
  heardCount: (n, cages) =>
    `Bien reçu. J'ai entendu ${n} ${cages ? (n === 1 ? 'cage' : 'cages') : n === 1 ? 'saisie' : 'saisies'}. Vérifiez avant que j'enregistre :`,
  fieldUnit: 'Unité',
  fieldFeed: 'Aliment',
  fieldMortality: 'Mortalité',
  fieldIssue: "Sortie d'aliment",
  fish: (n) => `${n} poissons`,
  notSaid: 'Non dit, enregistré comme 0',
  check: 'À VÉRIFIER',
  checkNote: (heard, value, unit) =>
    heard
      ? `J'ai entendu « ${heard} » (${value}) pour ${unit} mais la ligne était bruyante. Touchez Modifier si c'est faux.`
      : `Je ne suis pas sûr de ${value} pour ${unit}. Touchez Modifier si c'est faux.`,
  savingFor: (date, isToday) => (isToday ? `Enregistrement pour aujourd'hui, ${date}.` : `Enregistrement pour le ${date}.`),
  saveGroup: (n) => (n === 1 ? 'Enregistrer' : `Enregistrer les ${n}`),
  whichCage: (what) =>
    what ? `Je n'ai pas bien compris la cage. Laquelle avait ${what} ?` : "Je n'ai pas bien compris la cage. Laquelle était-ce ?",
  whatDead: (n) => (n === 1 ? '1 poisson mort' : `${n} poissons morts`),
  whatFeed: (kg) => `${kg} d'aliment`,
  another: 'Une autre',
  pickFromList: "Quelle cage ? Si elle n'est pas ici, touchez Annuler et renvoyez la note avec le nom de la cage.",
  cagePicked: (name) => `Entendu, ${name}.`,
  pickCageFirst: "Choisissez d'abord la cage, puis touchez Enregistrer.",
  voiceSaved: (names, mins) => `${names} enregistré. Vous pouvez annuler pendant ${mins} minutes.`,
  voiceUndoAll: (n) => (n === 1 ? 'Annulé. La saisie a été supprimée.' : `Annulé. ${n} saisies ont été supprimées.`),
  voiceLanguageSet: (lang) => `Notes vocales : j'écoute en ${lang}.`,
  voiceLanguageHelp: 'Envoyez VOICE TWI, VOICE EWE, VOICE GA, VOICE EN ou VOICE FR pour choisir la langue de vos notes vocales.',
}

export function t(locale: BotLocale): Strings {
  return locale === 'fr' ? fr : en
}

/**
 * WhatsApp utility templates to submit to Meta (doc 23 §8, runbook). Names
 * and bodies here must match the approved templates exactly.
 */
export const REMINDER_TEMPLATES: Record<BotLocale, { name: string; language: string }> = {
  en: { name: 'farm_daily_reminder', language: 'en' },
  fr: { name: 'farm_daily_reminder', language: 'fr' },
}

/**
 * Approval requests outside WhatsApp's 24-hour window (BOT-007, runbook §3).
 * Body: {{1}} kind, {{2}} requester, {{3}} what; quick replies Approve, Reject.
 */
export const APPROVAL_TEMPLATES: Record<BotLocale, { name: string; language: string }> = {
  en: { name: 'farm_approval_request', language: 'en' },
  fr: { name: 'farm_approval_request', language: 'fr' },
}
