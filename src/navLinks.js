import { Target, ClipboardCheck, Users, Send, ListChecks, Network } from 'lucide-react'

// Links shown depend on the person's role in the review app (see RevContext).
export function getLinks({ admin, superAdmin, headed }) {
  const links = [
    { to: '/goals', label: 'My goals', icon: Target },
    { to: '/reviews', label: 'My reviews', icon: ClipboardCheck },
    { to: '/team', label: 'My team', icon: Users },
  ]
  if (admin || (headed && headed.length > 0)) links.push({ to: '/launch', label: 'Launch reviews', icon: Send })
  if (admin) links.push({ to: '/admin/questions', label: 'Questions & cycles', icon: ListChecks })
  if (superAdmin) links.push({ to: '/admin/departments', label: 'Departments', icon: Network })
  return links
}
