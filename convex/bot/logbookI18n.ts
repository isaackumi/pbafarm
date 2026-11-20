/** Farm bot replies for logbook photos (BOT-006), English and French. */
import type { BotLocale } from './i18n'

const en = {
  saveAll: 'Save all',
  review: 'Review each',
  discardAll: 'Discard all',
  reading: 'Reading the logbook page…',
  disabled:
    'Reading logbook photos uses the assistant, which is not enabled for your organization. An administrator can enable it in Settings → AI.',
  noPermission: 'You do not have permission to record daily entries, so I cannot read logbook pages for you.',
  unavailable: 'I cannot read photos right now. Please type the entries or try again later.',
  tooLarge: (mb: number) => `This photo is too large (max ${mb} MB). Send it as a normal photo, not a file.`,
  badType: 'I can only read JPEG, PNG or WebP photos of a logbook page.',
  downloadFailed: 'I could not download the photo. Please send it again.',
  unreadable: 'I could not read this page. Take the photo flat, in good light, with the whole page in view, and send it again.',
  nothingFound: 'I found no unit rows on this page.',
  header: (n: number, date?: string) =>
    `I read ${n} ${n === 1 ? 'entry' : 'entries'} from the logbook${date ? ` (${date})` : ''}. Nothing is saved yet:`,
  readAs: (raw: string) => `read as "${raw}", please check`,
  flaggedHeader: 'Not turned into drafts (fix and send again, or enter in the app):',
  more: (n: number) => `…and ${n} more (tap ${en.review}).`,
  confirmAll: 'Save all, review them one by one, or discard?',
  unmatched: (candidates: string[]) => (candidates.length ? `which unit? ${candidates.join(', ')}` : 'no such unit at your site'),
  twice: 'unit appears twice on the page',
  dateRange: 'page date is more than 7 days ago or in the future',
  tooMany: 'too many rows on one page',
  discarded: (n: number) => `Discarded ${n} ${n === 1 ? 'draft' : 'drafts'}. Nothing was saved.`,
  noneOpen: 'No drafts from this page are still open.',
  savedAll: (saved: number, total: number) => `Saved ${saved} of ${total}.`,
  alreadyAll: 'These entries were already saved.',
  needsReview: (n: number) => `${n} look like entries sent a few minutes ago; tap ${en.review} to save them one by one.`,
  failedSome: (lines: string) => `Not saved:\n${lines}`,
}

type Strings = typeof en

const fr: Strings = {
  saveAll: 'Tout enregistrer',
  review: 'Revoir une à une',
  discardAll: 'Tout annuler',
  reading: 'Lecture de la page du registre…',
  disabled:
    "La lecture des photos du registre utilise l'assistant, qui n'est pas activé pour votre organisation. Un administrateur peut l'activer dans Paramètres → IA.",
  noPermission: "Vous n'avez pas le droit d'enregistrer les saisies quotidiennes : je ne peux pas lire de registre pour vous.",
  unavailable: 'Je ne peux pas lire de photos pour le moment. Tapez les saisies ou réessayez plus tard.',
  tooLarge: (mb: number) => `Cette photo est trop lourde (max ${mb} Mo). Envoyez-la comme photo, pas comme fichier.`,
  badType: "Je ne lis que les photos JPEG, PNG ou WebP d'une page de registre.",
  downloadFailed: "Je n'ai pas pu télécharger la photo. Renvoyez-la.",
  unreadable: "Je n'ai pas pu lire cette page. Photographiez-la à plat, bien éclairée, en entier, puis renvoyez-la.",
  nothingFound: "Je n'ai trouvé aucune ligne d'unité sur cette page.",
  header: (n: number, date?: string) =>
    `J'ai lu ${n} ${n === 1 ? 'saisie' : 'saisies'} dans le registre${date ? ` (${date})` : ''}. Rien n'est encore enregistré :`,
  readAs: (raw: string) => `lu « ${raw} », à vérifier`,
  flaggedHeader: "Non transformées en brouillons (corrigez et renvoyez, ou saisissez dans l'application) :",
  more: (n: number) => `…et ${n} de plus (touchez ${fr.review}).`,
  confirmAll: 'Tout enregistrer, revoir une à une, ou tout annuler ?',
  unmatched: (candidates: string[]) => (candidates.length ? `quelle unité ? ${candidates.join(', ')}` : 'unité inconnue sur votre site'),
  twice: 'unité présente deux fois sur la page',
  dateRange: 'date de la page à plus de 7 jours ou dans le futur',
  tooMany: 'trop de lignes sur une page',
  discarded: (n: number) => `${n} ${n === 1 ? 'brouillon annulé' : 'brouillons annulés'}. Rien n'a été enregistré.`,
  noneOpen: "Aucun brouillon de cette page n'est encore ouvert.",
  savedAll: (saved: number, total: number) => `${saved} sur ${total} enregistrées.`,
  alreadyAll: 'Ces saisies sont déjà enregistrées.',
  needsReview: (n: number) => `${n} ressemblent à des saisies envoyées il y a quelques minutes ; touchez ${fr.review} pour les enregistrer une à une.`,
  failedSome: (lines: string) => `Non enregistrées :\n${lines}`,
}

export function lt(locale: BotLocale): Strings {
  return locale === 'fr' ? fr : en
}
