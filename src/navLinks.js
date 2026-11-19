import { Target, ClipboardCheck, Users, Send, ListChecks, Network, Settings } from 'lucide-react'

// Links shown depend on the person's role in the review app (see RevContext).
export function getLinks({ admin, superAdmin, headed }) {
  const links = [
    { to: '/goals', label: 'My goals', icon: Target },
    { to: '/reviews', label: 'My reviews', icon: ClipboardCheck },
    { to: '/team', label: 'My team', icon: Users },
  ]

  const adminLinks = []
  if (admin || (headed && headed.length > 0)) adminLinks.push({ to: '/launch', label: 'Launch reviews', icon: Send })
  if (admin) adminLinks.push({ to: '/admin/questions', label: 'Questions & cycles', icon: ListChecks })
  if (superAdmin) adminLinks.push({ to: '/admin/departments', label: 'Departments', icon: Network })
  if (adminLinks.length > 0) links.push({ label: 'Admin', icon: Settings, children: adminLinks })

  return links
}
