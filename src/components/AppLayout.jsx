import { Link, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { Menu, X, LogOut, ChevronDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { signOut } from '../lib/auth'

// Left sidebar shell for apps with more than one or two pages. `links` is:
//   [{ to?, label, icon: LucideIcon, adminOnly?, badge?, children?: [{to,label}] }]
// A link with `children` renders as an expandable section — expanded
// automatically whenever the current route is the parent or one of its
// children (no manual collapse state to manage). A parent with no `to`
// is a heading only; its children are the real routes.
//
// Drop a <FeedbackWidget /> anywhere inside `children` (or here) if you want
// one — it's `position: fixed`, so where it's mounted in the tree doesn't
// affect where it renders.
export default function AppLayout({ appName, links, children }) {
  const { profile } = useAuth()
  const { pathname, search } = useLocation()
  const fullPath = pathname + search
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openSections, setOpenSections] = useState(new Set())

  const visibleLinks = links.filter(l => !l.adminOnly || profile?.role === 'admin')

  // Links with a query string (e.g. category filters) match the full
  // path+search; plain links match pathname (or a route nested under it).
  function isActive(to) {
    if (!to) return false
    if (to.includes('?')) return fullPath === to
    return pathname === to || pathname.startsWith(to + '/')
  }
  // Auto-expanded when the route is inside this section; a heading-only
  // parent (no `to`) has no route to auto-expand it, so it also tracks
  // manual open/close via toggleSection().
  function sectionExpanded(link) {
    return isActive(link.to) || (link.children || []).some(c => isActive(c.to)) || openSections.has(link.label)
  }
  function toggleSection(label) {
    setOpenSections(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <button
        onClick={() => setMobileOpen(o => !o)}
        className="md:hidden fixed top-3 left-3 z-30 bg-white border border-gray-200 shadow-sm rounded-lg p-2 text-brand"
        aria-label="Menu"
      >
        {mobileOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/30 z-20" onClick={() => setMobileOpen(false)} />
      )}

      <nav
        className={`w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col
          fixed md:sticky top-0 h-screen z-30 transition-transform duration-200
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        <div className="px-4 py-4 flex items-center gap-2 border-b border-gray-100">
          <img src="/sil-logo.png" alt="" className="h-6" />
          <span className="font-display font-bold text-brand text-sm leading-tight">{appName}</span>
        </div>

        <div className="flex-1 py-2 flex flex-col overflow-y-auto">
          {visibleLinks.map(link => {
            const Icon = link.icon
            const active = isActive(link.to)
            const expanded = sectionExpanded(link)
            const RowTag = link.to ? Link : 'button'

            return (
              <div key={link.to || link.label}>
                <RowTag
                  to={link.to}
                  onClick={() => {
                    if (link.to) setMobileOpen(false)
                    else toggleSection(link.label)
                  }}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm border-l-[3px] transition-colors text-left
                    ${active
                      ? 'border-brand text-brand bg-brand/[0.08] font-semibold'
                      : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                >
                  {Icon && <Icon size={16} className="flex-shrink-0" />}
                  <span className="truncate">{link.label}</span>
                  {!!link.badge && (
                    <span className="ml-auto bg-brand text-white rounded-full text-[11px] font-semibold px-1.5 leading-4">
                      {link.badge}
                    </span>
                  )}
                  {link.children?.length > 0 && (
                    <ChevronDown size={14} className={`ml-auto flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''} ${link.badge ? 'ml-1' : ''}`} />
                  )}
                </RowTag>

                {link.children?.length > 0 && expanded && (
                  <div className="flex flex-col">
                    {link.children.map(child => (
                      <Link
                        key={child.to}
                        to={child.to}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2 pl-10 pr-4 py-2 text-[13px] border-l-[3px] transition-colors
                          ${isActive(child.to)
                            ? 'border-brand text-brand font-medium'
                            : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
                      >
                        <span className="truncate">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
          <p className="truncate mb-1.5">{profile?.primary_email}</p>
          <button onClick={signOut} className="flex items-center gap-1.5 text-brand hover:underline">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </nav>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
