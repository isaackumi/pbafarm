import { WIDGET_CATALOG } from '../../convex/lib/dashboardLayout'

/**
 * Dashboard widget grid (CUSTOM-005). One column on phones, two on tablets,
 * twelve on wide screens; a widget's size sets its span. Span classes live
 * here (not in convex/lib) so Tailwind sees them.
 */
export const SPAN = {
  sm: 'col-span-1 xl:col-span-3',
  md: 'col-span-1 xl:col-span-4',
  half: 'col-span-1 sm:col-span-2 xl:col-span-6',
  lg: 'col-span-1 sm:col-span-2 xl:col-span-8',
  full: 'col-span-1 sm:col-span-2 xl:col-span-12',
}

/** Widgets the member may see (permission-gated widgets need it). */
export function visibleWidgets(widgets, can) {
  return (widgets || []).filter((w) => {
    const spec = WIDGET_CATALOG[w.widget]
    return spec && (!spec.permission || can(spec.permission))
  })
}

/** Props: widgets ([{ widget, size }]), nodes ({ widgetKey: node }). */
export default function WidgetGrid({ widgets, nodes }) {
  return (
    // Paper 01 Home: 20px between cards in a row, 28px between rows. A widget
    // with nothing to show (no alerts, no site) leaves no gap behind.
    <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-12">
      {widgets.map((w) =>
        nodes[w.widget] ? (
          <div
            key={w.widget}
            className={`${SPAN[w.size] ?? SPAN.md} min-w-0 empty:hidden [&:has(>:empty)]:hidden [&>*]:h-full`}
          >
            {nodes[w.widget]}
          </div>
        ) : null,
      )}
    </div>
  )
}
