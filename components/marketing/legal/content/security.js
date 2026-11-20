/** Paper "Legal · Security (1440)": structure only; words live in locales (marketing.legal.security). */
const S = 'marketing.legal.security.sections'

const security = {
  email: 'security@getanowa.com',
  sections: [
    {
      id: 'chain',
      blocks: [
        { type: 'p', key: `${S}.chain.p1` },
        {
          type: 'chain',
          base: `${S}.chain`,
          entries: [
            { n: 1041, event: 'harvest', prev: '7c1e…a90b', hash: '3f9a…12cd' },
            { n: 1042, event: 'daily', prev: '3f9a…12cd', hash: 'b04e…77f1' },
            { n: 1043, event: 'role', prev: 'b04e…77f1', hash: '9d22…c3a8' },
          ],
        },
      ],
    },
    {
      id: 'access',
      blocks: [
        { type: 'p', key: `${S}.access.p1` },
        { type: 'roles', base: `${S}.access.roles`, items: ['owner', 'admin', 'manager', 'field', 'viewer', 'custom'] },
        { type: 'p', key: `${S}.access.p2` },
      ],
    },
    { id: 'signin', blocks: [{ type: 'p', key: `${S}.signin.p1` }] },
    { id: 'transit', blocks: [{ type: 'p', key: `${S}.transit.p1` }] },
    { id: 'report', blocks: [{ type: 'p', key: `${S}.report.p1` }] },
  ],
}

export default security
