import { useState } from 'react'
import { useRouter } from 'next/router'
import { usePaginatedQuery } from 'convex/react'
import { Check, SlidersHorizontal, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import NotificationPreferencesCard from '../components/NotificationPreferencesCard'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { LineTabs } from '../components/settings'
import { useNotifications } from '../contexts/NotificationContext'
import { useT } from '../lib/i18n/context'
import { formatDateTime } from '../lib/format'
import { api } from '../convex/_generated/api'

/** Notification type → Paper 30 pill tone; the pill text names the type. */
const TONE = { error: 'red', warning: 'amber', success: 'green', info: 'cyan' }

/** Notifications inbox + delivery preferences (Paper 30, A4K-0). */
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
    <Layout
      title={t('notifications.title')}
      eyebrow={t('settingsUi.notif.eyebrow', { count: unreadCount || 0 })}
      actions={
        <>
          {unreadCount > 0 && (
            <GradientButton icon={Check} onClick={() => markAllAsRead()}>
              {t('notifications.markAllRead')}
            </GradientButton>
          )}
          <GradientButton icon={SlidersHorizontal} reverse href="#delivery">
            {t('settingsUi.notif.preferences')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <LineTabs
          label={t('notifications.title')}
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: t('notifications.all') },
            { value: 'unread', label: t('notifications.unread'), count: unreadCount || undefined },
          ]}
        />
        <div className="flex w-full flex-col items-start gap-5 xl:flex-row">
          <div className="flex w-full flex-col gap-5 xl:w-[760px] xl:shrink-0">
            <section
              aria-label={t('notifications.title')}
              className="flex flex-col rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px]"
            >
              {status === 'LoadingFirstPage' ? (
                <Skeleton className="h-40" />
              ) : results.length === 0 ? (
                <p className="py-4 text-[14px] leading-[18px] text-muted">
                  {tab === 'unread' ? t('notifications.emptyUnread') : t('notifications.empty')}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {results.map((n) => (
                    <li key={n.id} className="group flex items-start gap-[14px] border-t border-line py-4">
                      <span className="pt-[6px]">
                        <span
                          aria-hidden
                          className={`block size-2 rounded-pill ${n.read ? '' : 'bg-pearl-cyan'}`}
                        />
                        {!n.read && <span className="sr-only">{t('notifications.unread')}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className="flex min-w-0 grow basis-0 cursor-pointer flex-col gap-[6px] rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                      >
                        <span className="flex flex-wrap items-center gap-[10px]">
                          <Pill tone={TONE[n.type] || 'neutral'}>
                            {t.or(`settingsUi.notif.type.${n.type}`, t('settingsUi.notif.type.info'))}
                          </Pill>
                          <span className="text-[12px] leading-4 text-faint">{formatDateTime(n.created_at)}</span>
                        </span>
                        <span className={`text-[14px] leading-[18px] text-text ${n.read ? '' : 'font-semibold'}`}>
                          {n.title}
                        </span>
                        {n.message && <span className="text-[13px] leading-4 text-muted">{n.message}</span>}
                        {n.link && <span className="text-[12px] leading-4 text-pearl-cyan">{t('notifications.open')}</span>}
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {!n.read && (
                          <GhostButton size="sm" onClick={() => markAsRead(n.id)}>
                            {t('notifications.markRead')}
                          </GhostButton>
                        )}
                        <button
                          type="button"
                          aria-label={t('notifications.delete')}
                          onClick={() => deleteNotification(n.id)}
                          className="rounded-pill p-2 text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                        >
                          <Trash2 size={16} aria-hidden />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {status === 'CanLoadMore' && (
                <div className="flex justify-center border-t border-line pt-4">
                  <GhostButton onClick={() => loadMore(25)}>{t('notifications.loadMore')}</GhostButton>
                </div>
              )}
            </section>
          </div>
          <div className="flex w-full min-w-0 grow basis-0 flex-col gap-5">
            <NotificationPreferencesCard />
          </div>
        </div>
      </div>
    </Layout>
  )
}
