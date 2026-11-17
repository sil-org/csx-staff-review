import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { isAdmin, isSuperAdmin, myHeadedDepartments } from '../lib/rev'

// What this person can do in the review app: admin, super admin, and which departments they head.
// Authorization is enforced in Postgres (RLS + RPC checks); this only decides what to show.
const RevContext = createContext({ ready: false, admin: false, superAdmin: false, headed: [] })

export function RevProvider({ children }) {
  const { profile } = useAuth()
  const [state, setState] = useState({ ready: false, admin: false, superAdmin: false, headed: [] })

  useEffect(() => {
    if (!profile?.primary_email) { setState({ ready: false, admin: false, superAdmin: false, headed: [] }); return }
    let cancelled = false
    Promise.all([isAdmin(), isSuperAdmin(), myHeadedDepartments(profile.primary_email)])
      .then(([admin, superAdmin, headed]) => { if (!cancelled) setState({ ready: true, admin, superAdmin, headed }) })
      .catch(() => { if (!cancelled) setState({ ready: true, admin: false, superAdmin: false, headed: [] }) })
    return () => { cancelled = true }
  }, [profile?.primary_email])

  return <RevContext.Provider value={state}>{children}</RevContext.Provider>
}

export const useRev = () => useContext(RevContext)
