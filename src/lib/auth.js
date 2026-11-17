import { supabase } from './supabase'

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Called after OAuth callback — finds or creates a profile for this Google account.
// If a pendingLinkToken is in localStorage, links this account to the existing profile first.
export async function resolveProfile(authUser) {
  const pendingToken = localStorage.getItem('pendingLinkToken') || null
  if (pendingToken) localStorage.removeItem('pendingLinkToken')

  const { data: profileId, error: rpcError } = await supabase.rpc('resolve_profile', {
    p_token: pendingToken,
    p_supabase_user_id: authUser.id,
    p_email: authUser.email,
    p_display_name: authUser.user_metadata?.full_name || authUser.email,
  })
  if (rpcError) throw rpcError

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single()
  if (profileError) throw profileError
  return profile
}

export async function getLinkedAccounts(profileId) {
  const { data, error } = await supabase
    .from('linked_accounts')
    .select('supabase_user_id, email, linked_at')
    .eq('profile_id', profileId)
    .order('linked_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createLinkToken() {
  const { data, error } = await supabase.rpc('create_link_token')
  if (error) throw error
  return data
}
