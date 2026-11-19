import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { membersWithPermission } from '../approvalAlerts'
import { notifyUsers, type NotifyChannel } from './notify'
import { rateLimiter } from './rateLimits'
import { breachSummary, type Breach, type WqParameter } from './waterQuality'

/**
 * Sensor threshold alerts (ANLY-006). A sensor batch whose worst DO,
 * temperature, pH or ammonia value is outside the unit's thresholds notifies
 * the members who can see production at that unit's site, through
 * lib/notify (each person's channel preferences and quiet hours apply).
 *
 * At most one alert per unit and parameter per hour
 * (`sensorBreachAlertPerUnit`), so a gateway posting every minute does not
 * page anyone 60 times. Low oxygen is urgent and may go by SMS/WhatsApp;
 * the others go in-app and by email.
 */
export const ALERT_FIELDS: readonly WqParameter[] = ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia']

const URGENT: NotifyChannel[] = ['in_app', 'sms', 'whatsapp', 'email']
const ROUTINE: NotifyChannel[] = ['in_app', 'email']
const HOUR = 60 * 60 * 1000

export async function notifySensorBreaches(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  unit: Doc<'cages'>,
  breaches: Breach[],
  measuredAt: number,
): Promise<number> {
  const alerting: Breach[] = []
  for (const b of breaches) {
    if (!ALERT_FIELDS.includes(b.parameter)) continue
    const verdict = await rateLimiter.limit(ctx, 'sensorBreachAlertPerUnit', { key: `${unit._id}:${b.parameter}` })
    if (verdict.ok) alerting.push(b)
  }
  if (!alerting.length) return 0
  const users = await membersWithPermission(ctx, companyId, 'production.view', unit.locationId)
  if (!users.length) return 0
  const urgent = alerting.some((b) => b.parameter === 'dissolvedOxygen' && b.direction === 'low')
  const params = alerting.map((b) => b.parameter).sort().join(',')
  const result = await notifyUsers(ctx, {
    companyId,
    users,
    channels: urgent ? URGENT : ROUTINE,
    title: `${urgent ? 'Low oxygen' : 'Water quality alert'}: ${unit.name}`,
    message: `Sensor readings out of range on ${unit.name}: ${breachSummary(alerting)}`,
    link: `/sensors?unit=${unit._id}`,
    level: urgent ? 'error' : 'warning',
    dedupeKey: `sensor-breach:${unit._id}:${params}:${Math.floor(measuredAt / HOUR)}`,
    source: 'sensor.threshold.breached',
  })
  return result.notified
}
