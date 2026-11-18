import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button, FormCard, FormSection, FormActions, Field, Input, Select, Textarea } from '../ui'
import { useToast } from '../Toast'
import { useCurrency } from '../../hooks/useCurrency'
import { useT } from '../../lib/i18n/context'
import { localToday } from '../../lib/format'
import { errorMessage } from '../../lib/errorMessage'

const METHODS = ['cash', 'mobile_money', 'bank', 'cheque', 'other']

/**
 * One sale: edit it, record payments against it and issue its invoice
 * (INV-009). Financial edits need `finance.sales.correct` (canCorrect).
 * The parent keys this by sale id + updated_at so the form resets on change.
 */
export default function SaleDetailPanel({ sale, customers, canCorrect, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const { formatCurrency } = useCurrency()
  const saleId = sale.id || sale._id
  const payments = useQuery(api.invoices.listPayments, { saleId })
  const updateSale = useMutation(api.sales.updateSale)
  const recordPayment = useMutation(api.invoices.recordPayment)
  const markSalePaid = useMutation(api.invoices.markSalePaid)
  const removePayment = useMutation(api.invoices.removePayment)
  const issueInvoice = useMutation(api.invoices.issueInvoice)
  const voidInvoice = useMutation(api.invoices.voidInvoice)

  const isUnitSale = sale.unit_count != null
  const [edit, setEdit] = useState(() => ({
    saleDate: sale.sale_date,
    customerId: sale.customer_id || '',
    customerName: sale.customer_id ? '' : sale.customer_name || '',
    weightKg: String(sale.weight_kg ?? ''),
    pricePerKg: String(sale.price_per_kg ?? ''),
    notes: sale.notes || '',
  }))
  const [pay, setPay] = useState({
    amount: '',
    paidDate: localToday(),
    method: 'cash',
    reference: '',
  })
  const [invoice, setInvoice] = useState({
    issueDate: localToday(),
    dueDate: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      if (ok) showToast('success', ok)
      return true
    } catch (err) {
      showToast('error', errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = (e) => {
    e.preventDefault()
    const patch = { saleDate: edit.saleDate, notes: edit.notes.trim() }
    if (edit.customerId) patch.customerId = edit.customerId
    else if (edit.customerName.trim()) patch.customerName = edit.customerName.trim()
    if (!isUnitSale) {
      patch.weightKg = Number(edit.weightKg)
      patch.pricePerKg = Number(edit.pricePerKg)
    }
    run(() => updateSale({ id: saleId, patch }), t('sales.saleUpdated'))
  }

  const submitPayment = async (e) => {
    e.preventDefault()
    const done = await run(
      () =>
        recordPayment({
          saleId,
          amount: Number(pay.amount),
          paidDate: pay.paidDate,
          method: pay.method,
          reference: pay.reference.trim() || undefined,
        }),
      t('sales.paymentRecorded'),
    )
    if (done) setPay((p) => ({ ...p, amount: '', reference: '' }))
  }

  const balance = sale.balance ?? 0
  const livePayments = (payments || []).filter((p) => !p.voided)

  return (
    <FormCard className="mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-lg font-medium text-chart-ink">
            {t('sales.saleTitle', {
              buyer: sale.customer_name || '—',
              date: sale.sale_date,
            })}
          </h3>
          <p className="text-sm text-muted">
            {t('sales.totalPaidBalance', {
              total: formatCurrency(sale.total_amount),
              paid: formatCurrency(sale.amount_paid ?? 0),
              balance: formatCurrency(balance),
            })}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>

      {canCorrect && (
        <form onSubmit={saveEdit}>
          <FormSection title={t('sales.editSale')}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t('sales.saleDate')} htmlFor="edit-sale-date" required>
                <Input
                  id="edit-sale-date"
                  type="date"
                  value={edit.saleDate}
                  onChange={(e) => setEdit((p) => ({ ...p, saleDate: e.target.value }))}
                  required
                />
              </Field>
              <Field label={t('sales.buyer')} htmlFor="edit-sale-customer">
                <Select
                  id="edit-sale-customer"
                  value={edit.customerId}
                  onChange={(e) => setEdit((p) => ({ ...p, customerId: e.target.value }))}
                >
                  <option value="">{t('sales.buyerByName')}</option>
                  {(customers || []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {!edit.customerId && (
                <Field label={t('sales.buyerName')} htmlFor="edit-sale-buyer">
                  <Input
                    id="edit-sale-buyer"
                    value={edit.customerName}
                    onChange={(e) => setEdit((p) => ({ ...p, customerName: e.target.value }))}
                  />
                </Field>
              )}
              {isUnitSale ? (
                <p className="md:col-span-2 text-sm text-muted">{t('sales.unitSaleLocked')}</p>
              ) : (
                <>
                  <Field label={t('sales.weightKg')} htmlFor="edit-sale-kg" required>
                    <Input
                      id="edit-sale-kg"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="font-data"
                      value={edit.weightKg}
                      onChange={(e) => setEdit((p) => ({ ...p, weightKg: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label={t('sales.pricePerKg')} htmlFor="edit-sale-price" required>
                    <Input
                      id="edit-sale-price"
                      type="number"
                      step="0.01"
                      min="0"
                      className="font-data"
                      value={edit.pricePerKg}
                      onChange={(e) => setEdit((p) => ({ ...p, pricePerKg: e.target.value }))}
                      required
                    />
                  </Field>
                </>
              )}
              <Field label={t('common.notes')} htmlFor="edit-sale-notes" className="md:col-span-2">
                <Textarea
                  id="edit-sale-notes"
                  rows={2}
                  value={edit.notes}
                  onChange={(e) => setEdit((p) => ({ ...p, notes: e.target.value }))}
                />
              </Field>
            </div>
            {sale.invoice_id && <p className="mt-3 text-sm text-muted">{t('sales.invoiceLocksAmount')}</p>}
          </FormSection>
          <FormActions>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving') : t('sales.saveChanges')}
            </Button>
          </FormActions>
        </form>
      )}

      <FormSection title={t('sales.payments')}>
        {payments === undefined ? (
          <p className="text-sm text-muted">{t('common.loading')}</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted">{t('sales.noPayments')}</p>
        ) : (
          <ul className="divide-y divide-foam-deep text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className={p.voided ? 'line-through text-muted' : ''}>
                  <span className="font-data">{p.paid_date}</span> · {t(`sales.method.${p.method}`)}
                  {p.reference ? ` · ${p.reference}` : ''}
                  {p.voided && p.void_reason ? ` (${p.void_reason})` : ''}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-data font-semibold">{formatCurrency(p.amount)}</span>
                  {canCorrect && !p.voided && (
                    <button
                      type="button"
                      className="text-signal hover:underline"
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(t('sales.removePaymentReason'))
                        if (reason && reason.trim()) {
                          run(() => removePayment({ paymentId: p.id, reason }), t('sales.paymentRemoved'))
                        }
                      }}
                    >
                      {t('sales.remove')}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canCorrect && balance > 0.005 && (
          <form onSubmit={submitPayment} className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <Field label={t('sales.amount')} htmlFor="pay-amount" required>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={balance}
                className="font-data"
                value={pay.amount}
                onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))}
                required
              />
            </Field>
            <Field label={t('sales.paidDate')} htmlFor="pay-date" required>
              <Input
                id="pay-date"
                type="date"
                value={pay.paidDate}
                onChange={(e) => setPay((p) => ({ ...p, paidDate: e.target.value }))}
                required
              />
            </Field>
            <Field label={t('sales.methodLabel')} htmlFor="pay-method">
              <Select
                id="pay-method"
                value={pay.method}
                onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`sales.method.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('sales.reference')} htmlFor="pay-ref">
              <Input
                id="pay-ref"
                value={pay.reference}
                onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {t('sales.recordPayment')}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      markSalePaid({
                        saleId,
                        paidDate: pay.paidDate,
                        method: pay.method,
                        reference: pay.reference.trim() || undefined,
                      }),
                    t('sales.markedPaid'),
                  )
                }
              >
                {t('sales.markPaid')}
              </Button>
            </div>
          </form>
        )}
        {livePayments.length > 0 && balance <= 0.005 && (
          <p className="mt-3 text-sm text-muted">{t('sales.fullyPaid')}</p>
        )}
      </FormSection>

      <FormSection title={t('sales.invoice')}>
        {sale.invoice_id ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-data font-semibold">{sale.invoice_number}</span>
            <Button size="sm" variant="secondary" href={`/invoices/${sale.invoice_id}`}>
              {t('sales.viewInvoice')}
            </Button>
            {canCorrect && (
              <button
                type="button"
                className="text-signal hover:underline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('sales.voidInvoiceConfirm'))) {
                    run(() => voidInvoice({ invoiceId: sale.invoice_id }), t('sales.invoiceVoided'))
                  }
                }}
              >
                {t('sales.voidInvoice')}
              </button>
            )}
          </div>
        ) : (
          <form
            className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () =>
                  issueInvoice({
                    saleId,
                    issueDate: invoice.issueDate,
                    dueDate: invoice.dueDate || undefined,
                    notes: invoice.notes.trim() || undefined,
                  }),
                t('sales.invoiceIssued'),
              )
            }}
          >
            <Field label={t('sales.issueDate')} htmlFor="inv-date" required>
              <Input
                id="inv-date"
                type="date"
                value={invoice.issueDate}
                onChange={(e) => setInvoice((p) => ({ ...p, issueDate: e.target.value }))}
                required
              />
            </Field>
            <Field label={t('sales.dueDate')} htmlFor="inv-due">
              <Input
                id="inv-due"
                type="date"
                value={invoice.dueDate}
                onChange={(e) => setInvoice((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </Field>
            <Field label={t('common.notes')} htmlFor="inv-notes">
              <Input
                id="inv-notes"
                value={invoice.notes}
                onChange={(e) => setInvoice((p) => ({ ...p, notes: e.target.value }))}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {t('sales.issueInvoice')}
            </Button>
          </form>
        )}
      </FormSection>
    </FormCard>
  )
}
