/**
 * Sample data for every template, for the dev preview page (/dev/emails),
 * the HTML dump script and the tests. Matches the Paper artboards where the
 * backend has the same facts.
 */
import type { EmailContent, EmailContext } from './layout'
import {
  alertEmail,
  approvalEmail,
  inviteEmail,
  passwordResetEmail,
  scheduledReportEmail,
  verificationCodeEmail,
  weeklySummaryEmail,
} from './templates'

export type EmailSample = { id: string; title: string; render: (ctx: EmailContext) => EmailContent }

const INVITE_EXPIRES = Date.UTC(2026, 10, 27, 9, 0)

export const EMAIL_SAMPLES: EmailSample[] = [
  {
    id: 'e1-verification-code',
    title: 'E1 Verification code',
    render: (ctx) => verificationCodeEmail(ctx, { name: 'Kwame Mensah', code: '482913', minutes: 15 }),
  },
  {
    id: 'e2-password-reset',
    title: 'E2 Password reset',
    render: (ctx) => passwordResetEmail(ctx, { email: 'kwame@pbafarm.com', code: '90215837', minutes: 15 }),
  },
  {
    id: 'e3-invite',
    title: 'E3 Invite to a farm',
    render: (ctx) =>
      inviteEmail(ctx, {
        inviterName: 'Ama Owusu',
        orgName: 'PBA Farm Ltd',
        roleKey: 'field_staff',
        roleLabel: 'Field staff',
        email: 'kofi@pbafarm.com',
        token: '3f9c2a7b8e1d4c5f',
        expiresAt: INVITE_EXPIRES,
      }),
  },
  {
    id: 'e4-approval',
    title: 'E4 Approval needed',
    render: (ctx) =>
      approvalEmail(ctx, {
        kind: 'stocking',
        requesterName: 'Kofi Asante',
        summary: 'Stocking 20,000 fish into C-07 (batch B-2611)',
        orgName: 'PBA Farm Ltd',
        path: '/approvals',
      }),
  },
  {
    id: 'e4b-approval-escalated',
    title: 'E4b Approval still waiting',
    render: (ctx) =>
      approvalEmail(ctx, {
        kind: 'transfer',
        requesterName: 'Kofi Asante',
        summary: 'Transfer of 4,000 fish from C-02 to C-09',
        orgName: 'PBA Farm Ltd',
        path: '/approvals',
        waitedHours: 6,
      }),
  },
  {
    id: 'e5-alert-urgent',
    title: 'E5 Farm alert (urgent)',
    render: (ctx) =>
      alertEmail(ctx, {
        title: 'Oxygen is low in C-07.',
        message: 'Dissolved oxygen 3.1 mg/L on 2026-11-20 (sensor).',
        level: 'error',
        orgName: 'PBA Farm Ltd',
        path: '/water-quality',
        unitName: 'C-07',
        reading: { label: 'Dissolved oxygen', value: 3.1, unit: 'mg/L', limit: 4, direction: 'low', at: '05:40' },
      }),
  },
  {
    id: 'e5b-alert',
    title: 'E5b Farm alert (warning)',
    render: (ctx) =>
      alertEmail(ctx, {
        title: 'Feed stock is low',
        message: 'Raanan 4mm: 1,250 kg left, about 5 days at the current rate.',
        level: 'warning',
        orgName: 'PBA Farm Ltd',
        path: '/inventory-alerts',
      }),
  },
  {
    id: 'e6-weekly',
    title: 'E6 Weekly Anowa summary',
    render: (ctx) =>
      weeklySummaryEmail(ctx, {
        orgName: 'PBA Farm Ltd',
        siteName: 'Akosombo',
        weekStart: '2026-11-16',
        weekEnd: '2026-11-22',
        units: 38,
        goodNumber: { value: '1.38', label: 'Farm FCR this week, better than last week', detail: 'Down from 1.45 the week before.' },
        things: [
          { lead: 'B-12: Low oxygen at dawn.', detail: 'Alert still open.' },
          { lead: 'C-03 lost 412 fish this week.', detail: 'The most of any unit.' },
          { lead: 'Feed was 118% of the suggested ration.', detail: 'Check feed waste.' },
        ],
        report:
          'The farm fed 9,840 kg this week and gained 7,130 kg. FCR improved to 1.38 from 1.45. Mortality was 0.4%, mostly in C-03.\n\nPriorities: sample C-03 and check the morning feed on row B.',
        path: '/weekly-report',
      }),
  },
  {
    id: 'e7-report',
    title: 'E7 Scheduled report (with CSV)',
    render: (ctx) =>
      scheduledReportEmail(ctx, {
        name: 'Weekly feed use',
        datasetLabel: 'Feeding',
        period: { from: '2026-11-16', to: '2026-11-22' },
        numbers: [
          { label: 'Rows', value: '38' },
          { label: 'Feed (kg)', value: '9,840' },
          { label: 'Feedings', value: '266' },
        ],
        rows: 38,
        attachment: { filename: 'weekly-feed-use-2026-11-22.csv', attached: true },
        notes: [],
        preview: { columns: ['Unit', 'Feed (kg)'], rows: [['A-01', '260'], ['A-02', '255']], more: 36 },
        path: '/reports?report=sample',
        ownerName: 'Ama Owusu',
        orgName: 'PBA Farm Ltd',
      }),
  },
]
