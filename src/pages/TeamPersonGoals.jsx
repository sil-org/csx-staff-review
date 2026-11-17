import { useEffect, useState } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import Page, { Todo } from '../components/Page'
import { listGoals, listCheckins } from '../lib/rev'
import { fiscalYearOf, fiscalYearLabel } from '../lib/fiscal'

const STATUSES = [['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']]

export default function TeamPersonGoals() {
  const { email } = useParams()
  const location = useLocation()
  const displayName = location.state?.displayName || email

  const current = fiscalYearOf()
  const [fy, setFy] = useState(current)
  const [status, setStatus] = useState('active')
  const [goals, setGoals] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setGoals(null)
    listGoals({ ownerEmail: email, fiscalYear: fy === 'all' ? null : fy, status })
      .then(async list => {
        const withHistory = await Promise.all(list.map(async g => ({ ...g, history: await listCheckins(g.id) })))
        if (!cancelled) setGoals(withHistory)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [email, fy, status])

  return (
    <Page title={`${displayName}: goals`} subtitle={<><Link to="/team" className="text-sm">My team</Link> / {displayName}. Read-only.</>}>
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
          <li key={g.id} className={`border border-gray-200 rounded-xl p-4 ${g.status === 'cancelled' ? 'bg-gray-100' : 'bg-white'}`}>
            <div className="flex justify-between gap-3 flex-wrap items-start">
              <div className="min-w-0">
                <div className={`font-semibold text-[17px] ${g.status === 'cancelled' ? 'text-gray-600' : ''}`}>{g.title}</div>
                <div className="text-sm text-gray-600">{g.success_measure} · {fiscalYearLabel(g.fiscal_year)}</div>
              </div>
              <span className="bg-gray-100 text-gray-700 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap">{g.status}</span>
            </div>

            {g.status === 'cancelled' && (
              <div className="border-t border-gray-200 mt-3 pt-2 text-sm text-gray-600">
                <span className="font-semibold">Cancelled {new Date(g.cancelled_at).toLocaleDateString()}.</span> {g.cancel_reason}
              </div>
            )}

            {g.history?.length > 0 && (
              <div className="border-t border-gray-200 mt-3 pt-2 flex flex-col gap-1">
                <div className="text-xs font-semibold text-gray-600">Check-in history</div>
                {g.history.map(h => (
                  <div key={h.id} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <span className="w-16 font-semibold">{new Date(h.period_month).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                    <span className="w-12">{h.progress_pct ?? '—'}%</span>
                    <span className="w-24 text-gray-600">{h.status}</span>
                    <span className="flex-1 min-w-[200px]">{h.note}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Page>
  )
}
