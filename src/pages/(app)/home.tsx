import { Navigate } from 'react-router-dom'

/** OAuth completion lands on /home (scaffold auth route); the app's home is the evaluation list. */
export default function Home() {
  return <Navigate to="/evaluations" replace />
}
