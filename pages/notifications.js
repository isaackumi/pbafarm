import { useState } from 'react'
import { useRouter } from 'next/router'
import { usePaginatedQuery } from 'convex/react'
import { Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Button, Card, EmptyState, PageHeader, Skeleton, TabBar } from '../components/ui'
import { useNotifications } from '../contexts/NotificationContext'
import { useT } from '../lib/i18n/context'
import { formatDateTime } from '../lib/format'
import { api } from '../convex/_generated/api'

const TONE = {
  success: 'bg-lagoon-700',
  warning: 'bg-warn',
  error: 'bg-signal',
  info: 'bg-lake',
}

export default function NotificationsPage() {
  return (
    <ProtectedRoute>
      <NotificationsList />
    </ProtectedRoute>
  )
}

function NotificationsList() {
  const t = useT()
  const router = useRouter()
  const [tab, setTab] = useState('all')
  const { unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications()
  const { results, status, loadMore } = usePaginatedQuery(
    api.notifications.listPage,
    { unreadOnly: tab === 'unread' },
    { initialNumItems: 25 },
  )

  const open = async (n) => {
    if (!n.read) await markAsRead(n.id)
    if (n.link) router.push(n.link)
  }

  return (
    <Layout title={t('notifications.title')}>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        related={[{ label: t('notifications.preferences'), href: '/account' }]}
        actions={
          unreadCount > 0 && (
            <Button variant="secondary" onClick={() => markAllAsRead()}>
              {t('notifications.markAllRead')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-3">
        <TabBar
          tabs={[
            { id: 'all', label: t('notifications.all') },
            { id: 'unread', label: t('notifications.unread') },
          ]}
          active={tab}
          onChange={setTab}
        />
        {unreadCount > 0 && (
          <span className="text-sm text-muted">{t('notifications.unreadCount', { count: unreadCount })}</span>
        )}
      </div>
      <Card padding={false}>
        {status === 'LoadingFirstPage' ? (
          <div className="p-5">
            <Skeleton className="h-40" />
          </div>
        ) : results.length === 0 ? (
          <EmptyState title={tab === 'unread' ? t('notifications.emptyUnread') : t('notifications.empty')} />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {results.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 px-4 sm:px-5 py-3 ${n.read ? '' : 'bg-foam/50'}`}>
                <span
                  aria-hidden
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : TONE[n.type] || TONE.info}`}
                />
                <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left cursor-pointer">
                  <div className={`text-sm ${n.read ? 'text-muted' : 'font-medium text-chart-ink'}`}>{n.title}</div>
                  <div className="mt-0.5 text-sm text-muted">{n.message}</div>
                  <div className="mt-1 text-xs text-muted">
                    {formatDateTime(n.created_at)}
                    {n.link && <span className="ml-2 text-lake">{t('notifications.open')}</span>}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {!n.read && (
                    <Button size="sm" variant="ghost" onClick={() => markAsRead(n.id)}>
                      {t('notifications.markRead')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('notifications.delete')}
                    onClick={() => deleteNotification(n.id)}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {status === 'CanLoadMore' && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => loadMore(25)}>
            {t('notifications.loadMore')}
          </Button>
        </div>
      )}
    </Layout>
  )
}
