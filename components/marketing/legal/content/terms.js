/** Paper "Legal · Terms (1440)": structure only; words live in locales (marketing.legal.terms). */
const S = 'marketing.legal.terms.sections'

const terms = {
  email: 'legal@getanowa.com',
  sections: [
    { id: 'agreement', blocks: [{ type: 'p', key: `${S}.agreement.p1` }] },
    {
      id: 'data',
      blocks: [
        { type: 'p', key: `${S}.data.p1` },
        { type: 'callout', key: `${S}.data.callout` },
      ],
    },
    {
      id: 'fairuse',
      blocks: [
        { type: 'p', key: `${S}.fairuse.intro` },
        { type: 'donts', base: `${S}.fairuse.donts`, items: ['law', 'reach', 'probe', 'spam'] },
        { type: 'p', key: `${S}.fairuse.outro` },
      ],
    },
    { id: 'ai', blocks: [{ type: 'p', key: `${S}.ai.p1` }] },
    {
      id: 'plans',
      blocks: [
        { type: 'p', key: `${S}.plans.p1` },
        { type: 'p', key: `${S}.plans.p2` },
      ],
    },
    {
      id: 'limits',
      blocks: [
        { type: 'p', key: `${S}.limits.p1` },
        { type: 'p', key: `${S}.limits.p2` },
      ],
    },
  ],
}

export default terms
