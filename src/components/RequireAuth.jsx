import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RequireAuth({ children, role }) {
  const { session, profile, loading } = useAuth()

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>
  if (!session) return <Navigate to="/" replace />
  if (role && profile?.role !== role && profile?.role !== 'admin') {
    return <Navigate to="/goals" replace />
  }

  return children
}
