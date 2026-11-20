/** Paper "Legal · Cookies (1440)": structure only; words live in locales (marketing.legal.cookies). */
const S = 'marketing.legal.cookies.sections'

const cookies = {
  email: 'privacy@getanowa.com',
  sections: [
    {
      id: 'count',
      untitled: true,
      blocks: [
        {
          type: 'counter',
          items: [
            { id: 'ads', value: 0, key: `${S}.count.ads` },
            { id: 'analytics', value: 0, key: `${S}.count.analytics` },
            { id: 'security', value: 1, key: `${S}.count.security`, highlight: true },
          ],
        },
      ],
    },
    {
      id: 'jar',
      blocks: [
        { type: 'p', key: `${S}.jar.intro` },
        {
          type: 'table',
          base: `${S}.jar`,
          cols: [
            { id: 'what', width: 'lg:w-[170px]', strong: true },
            { id: 'why', grow: true },
            { id: 'kind', width: 'lg:w-[110px]', kind: true },
            { id: 'lasts', width: 'lg:w-[130px]', muted: true },
          ],
          rows: ['session', 'offline', 'bot', 'language', 'site', 'menu'],
          kinds: { session: 'essential', offline: 'essential', bot: 'security', language: 'preference', site: 'preference', menu: 'preference' },
        },
      ],
    },
    {
      id: 'controls',
      blocks: [
        { type: 'p', key: `${S}.controls.p1` },
        { type: 'p', key: `${S}.controls.p2` },
      ],
    },
    { id: 'changes', blocks: [{ type: 'p', key: `${S}.changes.p1` }] },
  ],
}

export default cookies
