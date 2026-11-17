import AppLayout from './AppLayout'
import { useRev } from '../context/RevContext'
import { getLinks } from '../navLinks'

export const APP_NAME = 'Staff Review'

export default function Page({ title, subtitle, children }) {
  const rev = useRev()
  return (
    <AppLayout appName={APP_NAME} links={getLinks(rev)}>
      <div className="p-8 max-w-4xl">
        <h1 className="font-display text-3xl font-bold text-brand">{title}</h1>
        {subtitle && <p className="text-gray-600 mt-1">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </AppLayout>
  )
}

export function Todo({ children }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-6 text-gray-600">
      {children}
    </div>
  )
}
