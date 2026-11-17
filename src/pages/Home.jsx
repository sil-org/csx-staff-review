import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { signInWithGoogle } from '../lib/auth'

export default function Home() {
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()

  if (loading) return <LoadingScreen />

  if (session && profile) {
    navigate("/goals")
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-10 text-center">
        <img src="/sil-logo.png" alt="SIL" className="h-14 mx-auto mb-6" />
        <h1 className="font-display text-3xl font-bold text-brand mb-2">
          {/* TODO: replace with your app's name */}
          Staff Review
        </h1>
        <p className="text-gray-500 mb-8 text-sm">Staff sign-in required</p>

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-lg px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition"
        >
          <GoogleIcon />
          Sign in with Google
        </button>

        <p className="mt-6 text-xs text-gray-400">
          Restricted to SIL staff. Sign in with your sil.org Google account.
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      Loading…
    </div>
  )
}
