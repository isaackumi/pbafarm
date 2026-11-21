import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import Layout from '../Layout'
import ProtectedRoute from '../ProtectedRoute'
import { Upload } from 'lucide-react'
import NavTabs from '../ui/NavTabs'
import { LoadingState } from '../ui'
import { HeaderAction } from '../ui/HeaderAction'
import { usePermissions } from '../../hooks/usePermission'
import { useT } from '../../lib/i18n/context'
import { MENU_SECTIONS } from '../../lib/navigation'
import { TAB_GROUPS, resolveTab, tabHref, visibleTabs } from '../../lib/tabGroups'
import { TabbedPageContext } from './tabbedContext'

// The existing page bodies, one per tab (lib/tabGroups `legacy`).
const loading = () => <LoadingState />
const BODIES = {
  'records/daily': dynamic(() => import('../../pages/daily-data'), { loading }),
  'records/sampling': dynamic(() => import('../../pages/biweekly-records'), { loading }),
  'records/stockings': dynamic(() => import('../../pages/stocking-management'), { loading }),
  'records/transfers': dynamic(() => import('../../pages/fish-transfers'), { loading }),
  'feedSetup/types': dynamic(() => import('../../pages/feed-types'), { loading }),
  'feedSetup/plans': dynamic(() => import('../../pages/feeding-plans'), { loading }),
  'feedAnalytics/feed': dynamic(() => import('../../pages/feed-management/analytics'), { loading }),
  'feedAnalytics/stock': dynamic(() => import('../../pages/inventory/analytics'), { loading }),
  'stock/levels': dynamic(() => import('../../pages/stock-levels'), { loading }),
  'stock/alerts': dynamic(() => import('../../pages/inventory-alerts'), { loading }),
  'catalog/items': dynamic(() => import('../../pages/inventory/items'), { loading }),
  'catalog/lots': dynamic(() => import('../../pages/inventory/lots'), { loading }),
  'regional/regions': dynamic(() => import('../../pages/reports/regions'), { loading }),
  'regional/group': dynamic(() => import('../../pages/group-reports'), { loading }),
  'settings/company': dynamic(() => import('../../pages/company-settings'), { loading }),
  'settings/global': dynamic(() => import('../../pages/global-settings'), { loading }),
  'people/members': dynamic(() => import('../../pages/users'), { loading }),
  'people/roles': dynamic(() => import('../../pages/users'), { loading }),
  'integrations/keys': dynamic(() => import('../../pages/api-keys'), { loading }),
  'integrations/outbound': dynamic(() => import('../../pages/webhooks'), { loading }),
  'integrations/inbound': dynamic(() => import('../../pages/inbound-webhooks'), { loading }),
  'integrations/docs': dynamic(() => import('../../pages/api-docs'), { loading }),
}

/**
 * One page made of several existing pages (Paper 71/71b "joined with +"):
 * the group's title, its section · group eyebrow, page tabs, then the chosen
 * tab's page body. The URL is `<group path>/<tab>`; a missing or closed tab
 * goes to the first tab the member may open.
 */
export default function TabbedGroupPage({ group: groupKey }) {
  const router = useRouter()
  const t = useT()
  const { can, loading: permsLoading } = usePermissions()
  const group = TAB_GROUPS[groupKey]
  const [slot, setSlot] = useState(null)

  const raw = router.query.groupTab
  const requested = Array.isArray(raw) ? raw[0] : raw
  const tab = permsLoading ? null : resolveTab(groupKey, requested, can)

  useEffect(() => {
    if (!router.isReady || permsLoading || !tab || requested === tab.key) return
    const query = { ...router.query }
    delete query.groupTab
    router.replace({ pathname: tabHref(groupKey, tab.key), query })
  }, [router, router.isReady, permsLoading, tab, requested, groupKey])

  const tabs = useMemo(
    () =>
      visibleTabs(groupKey, can).map((item) => ({
        href: tabHref(groupKey, item.key),
        label: t.or(item.labelKey, item.title),
        permission: item.permission ?? null,
      })),
    [groupKey, can, t],
  )

  const section = MENU_SECTIONS[group.section]
  const groupDef = section?.groups?.find((g) => g.key === group.group)
  const eyebrow = [
    t.or(`nav.section.${group.section}`, section?.title),
    groupDef ? t.or(`navSearch.group.${group.group}`, groupDef.title) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const title = t.or(group.labelKey, group.title)
  const Body = tab ? BODIES[`${groupKey}/${tab.key}`] : null
  const context = useMemo(() => (tab ? { slot, groupKey, tabKey: tab.key } : null), [slot, groupKey, tab])

  return (
    <ProtectedRoute>
      <Layout
        title={title}
        eyebrow={eyebrow}
        actions={
          <>
            <span ref={setSlot} className="contents" />
            {/* Paper 71b: Bulk upload is the Import button on Records. */}
            {group.importHref && (
              <HeaderAction href={group.importHref} ring="sky" icon={Upload}>
                {t('navSearch.import')}
              </HeaderAction>
            )}
          </>
        }
      >
        <NavTabs tabs={tabs} label={title} active={tab ? tabHref(groupKey, tab.key) : undefined} />
        {permsLoading ? (
          <LoadingState />
        ) : Body ? (
          <TabbedPageContext.Provider value={context}>
            <Body key={tab.key} />
          </TabbedPageContext.Provider>
        ) : (
          <p className="text-[14px] leading-[18px] text-muted">{t('navSearch.noAccess')}</p>
        )}
      </Layout>
    </ProtectedRoute>
  )
}
