const PRESETS = [10, 20, 25]

/**
 * Bag size for bags ↔ kg conversion on purchases.
 * Presets cover common sizes; number input allows any (e.g. 15).
 */
export default function BagSizeField({
  id = 'bag-size-kg',
  value,
  onChange,
  className = '',
}) {
  const numeric = Number(value)

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-chart-ink"
      >
        Bag size (kg)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => {
          const active = numeric === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() =>
                onChange({ target: { name: 'bag_size_kg', value: String(preset) } })
              }
              className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-lagoon-800 bg-lagoon-800 text-white'
                  : 'border-input-border bg-surface text-chart-ink hover:bg-foam-deep/40'
              }`}
            >
              {preset} kg
            </button>
          )
        })}
        <input
          id={id}
          type="number"
          name="bag_size_kg"
          value={value}
          onChange={onChange}
          step="0.1"
          min="0.1"
          placeholder="Custom"
          className="block w-24 min-h-9 rounded-md border border-input-border px-3 py-1.5 font-data text-sm shadow-sm focus:border-lagoon-800 focus:outline-none focus:ring-lagoon-800"
        />
      </div>
      <p className="mt-1 text-xs text-muted">
        Defaults from the feed type — change if this lot uses a different bag size.
      </p>
    </div>
  )
}
