import ProtectedRoute from '../components/ProtectedRoute'
import { AssistantPage } from '../components/AiAssistant'

export default function Assistant() {
  return (
    <ProtectedRoute permission="ai.use">
      <AssistantPage />
    </ProtectedRoute>
  )
}
