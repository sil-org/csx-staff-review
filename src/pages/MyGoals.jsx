import { useEffect, useState } from 'react'
import Page, { Todo } from '../components/Page'
import { listGoals } from '../lib/rev'
import { fiscalYearOf, fiscalYearLabel } from '../lib/fiscal'

const STATUSES = [['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']]

// Goals list with status + fiscal year filters. Check-ins inside the card, cancel with a reason: TODO
// (design/Main.dc.html). Data comes from rev_goals via RLS (owner + direct manager).
export default function MyGoals() {
  const current = fiscalYearOf()
  const [fy, setFy] = useState(current)
  const [status, setStatus] = useState('active')
  const [goals, setGoals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setGoals(null)
    listGoals({ fiscalYear: fy === 'all' ? null : fy, status })
      .then(setGoals).catch(e => setError(e.message))
  }, [fy, status])

  return (
    <Page title="My goals" subtitle={fy === 'all' ? 'All fiscal years' : fiscalYearLabel(fy)}>
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div role="group" aria-label="Filter goals by status" className="flex gap-2 flex-wrap">
          {STATUSES.map(([key, label]) => (
            <button key={key} aria-pressed={status === key} onClick={() => setStatus(key)}
              className={`px-4 min-h-[44px] rounded-full border text-sm font-semibold ${status === key ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
          Fiscal year
          <select value={fy} onChange={e => setFy(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
            {[current, current - 1, current - 2].map(y => <option key={y} value={y}>FY{y}{y === current ? ' (current)' : ''}</option>)}
            <option value="all">All years</option>
          </select>
        </label>
      </div>

      {error && <p role="alert" className="text-red-700">{error}</p>}
      {goals === null && !error && <p className="text-gray-500">Loading…</p>}
      {goals && goals.length === 0 && <Todo>No goals match this filter.</Todo>}
      <ul className="space-y-3">
        {(goals || []).map(g => (
          <li key={g.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="font-semibold">{g.title}</div>
            <div className="text-sm text-gray-600">FY{g.fiscal_year} · {g.status}</div>
          </li>
        ))}
      </ul>
    </Page>
  )
}
