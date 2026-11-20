/** Paper "Legal · Privacy (1440)": structure only; words live in locales (marketing.legal.privacy). */
const S = 'marketing.legal.privacy.sections'

const privacy = {
  email: 'privacy@getanowa.com',
  sections: [
    {
      id: 'collect',
      blocks: [
        { type: 'p', key: `${S}.collect.intro` },
        { type: 'rows', base: `${S}.collect.rows`, items: ['account', 'records', 'messages', 'security'] },
      ],
    },
    {
      id: 'why',
      blocks: [
        { type: 'p', key: `${S}.why.body` },
        { type: 'callout', key: `${S}.why.callout` },
      ],
    },
    {
      id: 'processors',
      blocks: [
        { type: 'p', key: `${S}.processors.intro` },
        {
          type: 'table',
          base: `${S}.processors`,
          cols: [
            { id: 'who', width: 'lg:w-[190px]', strong: true },
            { id: 'what', grow: true },
            { id: 'when', width: 'lg:w-[150px]', muted: true },
          ],
          rows: ['convex', 'vercel', 'cloudflare', 'ai', 'messaging', 'email'],
        },
      ],
    },
    {
      id: 'ai',
      blocks: [
        { type: 'p', key: `${S}.ai.p1` },
        { type: 'p', key: `${S}.ai.p2` },
        { type: 'p', key: `${S}.ai.p3` },
      ],
    },
    {
      id: 'retention',
      blocks: [{ type: 'timeline', base: `${S}.retention.items`, items: ['records', 'chats', 'exports', 'deletion', 'audit'] }],
    },
    {
      id: 'rights',
      blocks: [
        { type: 'p', key: `${S}.rights.body` },
        { type: 'chips', base: `${S}.rights.chips`, items: ['see', 'correct', 'export', 'delete', 'object'] },
      ],
    },
  ],
}

export default privacy
