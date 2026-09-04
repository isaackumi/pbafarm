import { Field, Select } from './ui'
import DependencyEmpty from './DependencyEmpty'

/**
 * Feed type select with instruction hint and inline create when the catalog is empty
 * (same dependent-form pattern as cages / farm location).
 */
export default function FeedTypeField({
  id = 'feedTypeId',
  name = 'feedTypeId',
  label = 'Feed type',
  value = '',
  onChange,
  feedTypes,
  /** When false, treats list as still loading (disables empty state). */
  ready = true,
  required = false,
  disabled = false,
  className = '',
  fieldClassName = '',
  showStock = true,
  hint = 'Catalog product you buy and feed. Create one if the list is empty, then record a purchase for stock.',
  emptyMessage = 'Add a feed type before continuing. Purchases and daily feed need a type on the catalog.',
  /** When true, offer “Record a purchase” as a second action (skip on purchase forms). */
  offerPurchaseCreate = true,
  onCreated,
  onFeedTypesChanged,
}) {
  const list = Array.isArray(feedTypes) ? feedTypes : []
  const empty = ready && list.length === 0

  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      className={fieldClassName}
    >
      <Select
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled || empty}
        className={className}
      >
        <option value="">
          {empty ? 'No feed types available' : 'Select feed type…'}
        </option>
        {list.map((t) => {
          const tid = t.id || t._id
          const stock = Number(t.current_stock ?? t.currentStock ?? 0)
          const bags = Number(t.current_stock_bags ?? t.currentStockBags ?? 0)
          return (
            <option key={tid} value={tid}>
              {t.name}
              {showStock
                ? ` (${stock.toFixed(1)} kg${
                    bags > 0 ? ` / ${bags.toFixed(1)} bags` : ''
                  })`
                : ''}
            </option>
          )
        })}
      </Select>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {empty && (
        <DependencyEmpty
          message={emptyMessage}
          createKind="feedType"
          createLabel="Create feed type"
          secondaryCreateKind={offerPurchaseCreate ? 'purchase' : undefined}
          secondaryCreateLabel={
            offerPurchaseCreate ? 'Record a purchase' : undefined
          }
          onCreated={(result) => {
            onFeedTypesChanged?.()
            onCreated?.(result)
          }}
        />
      )}
    </Field>
  )
}
