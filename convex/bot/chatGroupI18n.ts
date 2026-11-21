/**
 * Strings for Telegram group chats (VFQ-1) and chat summaries, in English and
 * French. Text that goes inside Telegram HTML is escaped by the caller
 * (escapeHtml), never here.
 */
import type { BotLocale } from './i18n'
import type { RangeKind } from './scopeResolver'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export type CapKey = 'ask' | 'log' | 'alerts' | 'money' | 'buyers'

const en = {
  // Linking (/connect, /disconnect, my_chat_member)
  welcome: (bot: string) =>
    `Hi, I'm Anowa. To use me here, an admin sends /connect in this group. Everyone links their own account first in a private chat with me${bot ? ` (@${bot})` : ''}.`,
  unlinked: (link: string) => `Message me privately to link your Anowa account first: ${link}`,
  notConnected: 'This group is not linked to a farm yet. An admin sends /connect here.',
  linkedOther: 'This group is linked to another organization.',
  linkedTo: (company: string) =>
    `This group is linked to ${company}. Send ORG to me in our private chat and pick ${company} to use me here.`,
  alreadyLinked: (company: string) => `This group is already linked to ${company}. Admins change what it sees with /access.`,
  needAdmin: 'Only an organization admin (Configure messaging channels) can do that. Ask your admin.',
  pickOrg: 'Which organization should this group belong to?',
  pickScope: (company: string) =>
    `Link this group to ${company}. Which farm locations can it see? Tap sites, then Done.`,
  allLocations: 'All farm locations',
  done: 'Done',
  cancel: 'Cancel',
  pickAtLeastOne: 'Pick at least one site.',
  connected: (company: string, scope: string, bot: string) =>
    `Linked to ${company} · ${scope}.\nEveryone acts as themselves: each person sees only what their own role allows. Tag me${bot ? ` (@${bot})` : ''} or reply to me. Admins: /access.`,
  connectCancelled: 'Not linked.',
  connectBusy: (name: string) => `${name} is linking this group. Only they can finish.`,
  disconnected: (company: string) => `This group is no longer linked to ${company}.`,
  // /access
  accessTitle: (company: string, scope: string) =>
    `<b>Group access · ${company}</b>\nSites: ${scope}\n\nTap to change. A person never gets more than their own role allows.`,
  caps: { ask: 'Questions', log: 'Data entry', alerts: 'Alerts', money: 'Money', buyers: 'Buyers' } as Record<CapKey, string>,
  accessSaved: (scope: string) => `Group access saved · ${scope}.`,
  onlyOwnSites: 'You can only add sites you can see yourself.',
  onlyAllAdmin: 'Only someone who sees all farm locations can open the group to all of them.',
  sitesCount: (n: number) => `${n} ${plural(n, 'site', 'sites')}`,
  // Access limits
  askOff: 'Questions are off in this group. An admin can turn them on with /access.',
  logOff: 'Data entry is off in this group. Send it to me in our private chat, or an admin turns it on with /access.',
  roleLimit:
    "Your role doesn't cover the farm locations this group sees, so I can't show you anything here. Ask your admin to widen your access in Anowa (Settings › Team).",
  privateOnly: 'Send that to me in our private chat.',
  mediaPrivate: 'Send photos and voice notes to me in our private chat. Entries are saved there, not here.',
  sentPrivately: (name: string) =>
    `Sent you the draft in our private chat${name ? `, ${name}` : ''}. Entries are saved there, not here.`,
  sentCardsPrivately: (name: string) => `Sent you the cards in our private chat${name ? `, ${name}` : ''}.`,
  groupHelp: (bot: string) =>
    [
      `In this group, tag me${bot ? ` (@${bot})` : ''} or reply to one of my messages:`,
      '• "summary", "summary from offshore", "how is c7 this week?"',
      "• /today: today across this group's farm locations",
      '• /t, /round: I send the cards to you privately',
      'Admins: /access, /disconnect.',
      'Who can act: everyone acts as themselves. Buttons work only for the person they are for.',
    ].join('\n'),
  // Button owners
  onlyCanSave: (name: string) => `Only ${name} can save this.`,
  onlyCanApprove: (name: string) => `Only ${name} can approve this.`,
  onlyAsker: (name: string) => `Only ${name} can pick this. Ask me yourself.`,
  notHere: 'Open our private chat to use that button.',
  // Summaries
  allSites: 'All sites',
  period: (kind: RangeKind, from: string, to: string) => {
    const name = { today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_7_days: 'Last 7 days', this_month: 'This month' }[kind]
    return from === to ? `${name} (${from})` : `${name} (${from} to ${to})`
  },
  logged: (x: number, y: number) => `Logged ${x} of ${y} ${plural(y, 'unit', 'units')}.`,
  missing: (names: string[], more: number) => `Still missing: ${names.join(', ')}${more ? ` +${more}` : ''}.`,
  entries: (n: number) => `${n} daily ${plural(n, 'entry', 'entries')}.`,
  feedDead: (kg: string, dead: number) => `Feed ${kg} kg · ${dead} dead.`,
  lowDo: (v: string, unit: string) => `Lowest DO ${v} mg/L (${unit}).`,
  fish: (n: string) => `Fish on hand about ${n}.`,
  unitState: (fish: string, abw: string | null) => `${fish} fish${abw ? ` · ABW ${abw} g` : ''}.`,
  harvest: (kg: string) => `Harvested ${kg} kg.`,
  money: (cur: string, feed: string, sales: string, expenses: string) =>
    `Feed cost ${cur} ${feed} · sales ${cur} ${sales} · expenses ${cur} ${expenses}.`,
  unitLogged: (yes: boolean): string => (yes ? 'Logged today.' : 'Not logged yet today.'),
  noUnits: 'No units in this scope.',
  partial: '(Partial: too many entries to count them all.)',
  clarify: 'Which data? Pick where to pull it from.',
  clarifyAmbiguous: 'I found more than one. Which one?',
  aCage: 'A cage…',
  askCage: 'Which cage? Reply to this message with its code, like C-07.',
  noCage: (code: string) => `I can't find ${code} in the farm locations you can see here. Reply with another code.`,
  // Group alerts
  notLoggedAlert: (units: string, deadline: string): string => `${units} not logged yet today (due by ${deadline}).`,
}

type Strings = typeof en

const fr: Strings = {
  welcome: (bot: string) =>
    `Bonjour, je suis Anowa. Pour m'utiliser ici, un administrateur envoie /connect dans ce groupe. Chacun lie d'abord son propre compte dans une discussion privée avec moi${bot ? ` (@${bot})` : ''}.`,
  unlinked: (link: string) => `Écrivez-moi d'abord en privé pour lier votre compte Anowa : ${link}`,
  notConnected: "Ce groupe n'est pas encore lié à une ferme. Un administrateur envoie /connect ici.",
  linkedOther: 'Ce groupe est lié à une autre organisation.',
  linkedTo: (company: string) =>
    `Ce groupe est lié à ${company}. Envoyez ORG dans notre discussion privée et choisissez ${company} pour m'utiliser ici.`,
  alreadyLinked: (company: string) =>
    `Ce groupe est déjà lié à ${company}. Les administrateurs changent ce qu'il voit avec /access.`,
  needAdmin: "Seul un administrateur de l'organisation (Configurer les canaux de messagerie) peut le faire. Demandez à votre administrateur.",
  pickOrg: 'À quelle organisation ce groupe doit-il appartenir ?',
  pickScope: (company: string) =>
    `Lier ce groupe à ${company}. Quels sites peut-il voir ? Touchez les sites, puis Terminé.`,
  allLocations: 'Tous les sites de la ferme',
  done: 'Terminé',
  cancel: 'Annuler',
  pickAtLeastOne: 'Choisissez au moins un site.',
  connected: (company: string, scope: string, bot: string) =>
    `Lié à ${company} · ${scope}.\nChacun agit en son nom : chaque personne ne voit que ce que son rôle permet. Mentionnez-moi${bot ? ` (@${bot})` : ''} ou répondez-moi. Administrateurs : /access.`,
  connectCancelled: 'Non lié.',
  connectBusy: (name: string) => `${name} est en train de lier ce groupe. Seule cette personne peut terminer.`,
  disconnected: (company: string) => `Ce groupe n'est plus lié à ${company}.`,
  accessTitle: (company: string, scope: string) =>
    `<b>Accès du groupe · ${company}</b>\nSites : ${scope}\n\nTouchez pour modifier. Personne n'obtient plus que ce que son rôle permet.`,
  caps: { ask: 'Questions', log: 'Saisie', alerts: 'Alertes', money: 'Argent', buyers: 'Acheteurs' },
  accessSaved: (scope: string) => `Accès du groupe enregistré · ${scope}.`,
  onlyOwnSites: 'Vous ne pouvez ajouter que des sites que vous voyez vous-même.',
  onlyAllAdmin: "Seule une personne qui voit tous les sites peut ouvrir le groupe à tous les sites.",
  sitesCount: (n: number) => `${n} ${plural(n, 'site', 'sites')}`,
  askOff: 'Les questions sont désactivées dans ce groupe. Un administrateur peut les activer avec /access.',
  logOff:
    'La saisie est désactivée dans ce groupe. Envoyez-la-moi en privé, ou un administrateur l’active avec /access.',
  roleLimit:
    "Votre rôle ne couvre pas les sites que ce groupe voit, je ne peux donc rien vous montrer ici. Demandez à votre administrateur d'élargir votre accès dans Anowa (Paramètres › Équipe).",
  privateOnly: 'Envoyez-moi cela dans notre discussion privée.',
  mediaPrivate:
    'Envoyez les photos et les notes vocales dans notre discussion privée. Les saisies y sont enregistrées, pas ici.',
  sentPrivately: (name: string) =>
    `Je vous ai envoyé le brouillon en privé${name ? `, ${name}` : ''}. Les saisies sont enregistrées là-bas, pas ici.`,
  sentCardsPrivately: (name: string) => `Je vous ai envoyé les cartes en privé${name ? `, ${name}` : ''}.`,
  groupHelp: (bot: string) =>
    [
      `Dans ce groupe, mentionnez-moi${bot ? ` (@${bot})` : ''} ou répondez à un de mes messages :`,
      '• « bilan », « bilan offshore », « comment va c7 cette semaine ? »',
      "• /today : aujourd'hui sur les sites de ce groupe",
      '• /t, /round : je vous envoie les cartes en privé',
      'Administrateurs : /access, /disconnect.',
      'Qui peut agir : chacun agit en son nom. Les boutons ne marchent que pour la personne concernée.',
    ].join('\n'),
  onlyCanSave: (name: string) => `Seul(e) ${name} peut enregistrer ceci.`,
  onlyCanApprove: (name: string) => `Seul(e) ${name} peut approuver ceci.`,
  onlyAsker: (name: string) => `Seul(e) ${name} peut choisir. Demandez-moi vous-même.`,
  notHere: 'Ouvrez notre discussion privée pour utiliser ce bouton.',
  allSites: 'Tous les sites',
  period: (kind: RangeKind, from: string, to: string) => {
    const name = {
      today: "Aujourd'hui",
      yesterday: 'Hier',
      this_week: 'Cette semaine',
      last_7_days: '7 derniers jours',
      this_month: 'Ce mois-ci',
    }[kind]
    return from === to ? `${name} (${from})` : `${name} (du ${from} au ${to})`
  },
  logged: (x: number, y: number) => `${x} sur ${y} ${plural(y, 'unité saisie', 'unités saisies')}.`,
  missing: (names: string[], more: number) => `Manquent encore : ${names.join(', ')}${more ? ` +${more}` : ''}.`,
  entries: (n: number) => `${n} ${plural(n, 'saisie journalière', 'saisies journalières')}.`,
  feedDead: (kg: string, dead: number) => `Aliment ${kg} kg · ${dead} ${plural(dead, 'mort', 'morts')}.`,
  lowDo: (v: string, unit: string) => `OD le plus bas ${v} mg/L (${unit}).`,
  fish: (n: string) => `Environ ${n} poissons en stock.`,
  unitState: (fish: string, abw: string | null) => `${fish} poissons${abw ? ` · PMI ${abw} g` : ''}.`,
  harvest: (kg: string) => `Récolté ${kg} kg.`,
  money: (cur: string, feed: string, sales: string, expenses: string) =>
    `Coût aliment ${cur} ${feed} · ventes ${cur} ${sales} · dépenses ${cur} ${expenses}.`,
  unitLogged: (yes: boolean) => (yes ? "Saisi aujourd'hui." : "Pas encore saisi aujourd'hui."),
  noUnits: 'Aucune unité dans ce périmètre.',
  partial: '(Partiel : trop de saisies pour tout compter.)',
  clarify: "Quelles données ? Choisissez d'où les tirer.",
  clarifyAmbiguous: "J'en ai trouvé plusieurs. Lequel ?",
  aCage: 'Une cage…',
  askCage: 'Quelle cage ? Répondez à ce message avec son code, par exemple C-07.',
  noCage: (code: string) => `Je ne trouve pas ${code} dans les sites que vous voyez ici. Répondez avec un autre code.`,
  notLoggedAlert: (units: string, deadline: string): string => `${units} : pas encore saisi(s) aujourd'hui (avant ${deadline}).`,
}

export function gt(locale: BotLocale): Strings {
  return locale === 'fr' ? fr : en
}
