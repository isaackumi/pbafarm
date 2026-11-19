import { usePermission } from '../../hooks/usePermission'
import { routePermission } from '../../lib/routePermissions'
import { GradientButton } from './Buttons'

/**
 * Page-header GradientButton that hides itself when the member lacks
 * `permission`, or the permission its `href` page needs (like Button).
 */
export function HeaderAction({ permission, href, ...props }) {
  const allowed = usePermission(permission || routePermission(href))
  return allowed ? <GradientButton href={href} {...props} /> : null
}

export default HeaderAction
