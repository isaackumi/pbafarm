import ProtectedRoute from '../components/ProtectedRoute'
import AskAnowaPage from '../components/AskAnowa'

/**
 * Ask Anowa, expanded (Paper 47/47b). Deep links: `/assistant?chat=<id>`
 * opens one of the member's conversations, `/assistant?view=saved` the saved
 * answers. The compact bubble's expand button and the top-bar button land here.
 */
export default function Assistant() {
  return (
    <ProtectedRoute permission="ai.use">
      <AskAnowaPage />
    </ProtectedRoute>
  )
}
