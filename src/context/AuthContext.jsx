import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { resolveProfile } from '../lib/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) resolveProfile(session.user).then(setProfile)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        resolveProfile(session.user).then(setProfile)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function refreshProfile() {
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s?.user) resolveProfile(s.user).then(setProfile)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading: session === undefined || (session !== null && profile === null), refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
