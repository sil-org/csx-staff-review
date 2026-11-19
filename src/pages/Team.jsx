import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Page, { Todo } from '../components/Page'
import { useAuth } from '../context/AuthContext'
import { teamStatus, teamRoster, teamCheckinStatus, teamLastNudge, listReviewIds, listProfiles, requestNudge } from '../lib/rev'
import { periodLabel, statusLabel } from '../lib/reviewLabels'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

function periodKey(kind, year, quarter) {
  return `${kind}:${year}:${quarter ?? ''}`
}

export default function Team() {
  const { profile } = useAuth()
  const me = profile?.primary_email?.toLowerCase()

  const [rows, setRows] = useState(null)
  const [roster, setRoster] = useState(null)
  const [error, setError] = useState('')
  const [view, setView] = useState('team') // 'team' | 'direct'
  const [period, setPeriod] = useState('all')
  const [remindError, setRemindError] = useState('')

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setRoster(null)
    Promise.all([teamStatus(), teamCheckinStatus(), teamLastNudge(), listReviewIds(), teamRoster()])
      .then(async ([statusRows, checkins, nudges, reviewIds, rosterRows]) => {
        const checkinByEmail = Object.fromEntries(checkins.map(c => [c.employee_email, c]))
        const nudgeByEmail = Object.fromEntries(nudges.map(n => [n.employee_email, n.last_nudged_at]))
        const idByKey = Object.fromEntries(
          reviewIds.map(r => [periodKey(r.kind, r.period_year, r.period_quarter) + '|' + r.employee_email, r.id])
        )
        const managerEmails = [...new Set(statusRows.map(r => r.manager_email).filter(e => e && e !== me))]
        let nameByEmail = {}
        if (managerEmails.length > 0) {
          try {
            const profiles = await listProfiles(managerEmails)
            nameByEmail = Object.fromEntries(profiles.map(p => [p.primary_email.toLowerCase(), p.display_name]))
          } catch {
            // Best-effort only -- fall back to showing the raw email below.
          }
        }

        const merged = statusRows.map(r => {
          const checkin = checkinByEmail[r.employee_email]
          return {
            employeeEmail: r.employee_email,
            displayName: r.display_name,
            managerEmail: r.manager_email,
            managerName: r.manager_email === me ? 'You' : (nameByEmail[r.manager_email] || r.manager_email),
            isDirect: r.manager_email === me,
            kind: r.kind,
            year: r.period_year,
            quarter: r.period_quarter,
            status: r.status,
            reviewId: idByKey[periodKey(r.kind, r.period_year, r.period_quarter) + '|' + r.employee_email] || null,
            activeGoals: checkin?.active_goals ?? null,
            checkedIn: checkin?.checked_in ?? null,
            lastNudgedAt: nudgeByEmail[r.employee_email] || null,
          }
        })
        if (!cancelled) { setRows(merged); setRoster(rosterRows) }
      })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [me])

  const periods = useMemo(() => {
    if (!rows) return []
    const seen = new Map()
    for (const r of rows) {
      const key = periodKey(r.kind, r.year, r.quarter)
      if (!seen.has(key)) seen.set(key, { key, kind: r.kind, year: r.year, quarter: r.quarter })
    }
    return [...seen.values()].sort((a, b) => b.year - a.year || (b.quarter ?? -1) - (a.quarter ?? -1))
  }, [rows])

  const rosterFiltered = useMemo(() => {
    if (!roster) return []
    return view === 'direct' ? roster.filter(p => p.is_direct) : roster
  }, [roster, view])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter(r => {
      if (view === 'direct' && !r.isDirect) return false
      if (period !== 'all' && periodKey(r.kind, r.year, r.quarter) !== period) return false
      return true
    })
  }, [rows, view, period])

  const tiles = useMemo(() => {
    const counts = {}
    for (const r of filtered) counts[r.status] = (counts[r.status] || 0) + 1
    return ['draft', 'with_manager', 'awaiting_employee', 'locked'].map(status => ({
      status, label: statusLabel(status), count: counts[status] || 0,
    }))
  }, [filtered])

  async function handleRemind(email) {
    setRemindError('')
    try {
      const sent = await requestNudge(email)
      if (sent) {
        setRows(prev => prev.map(r => r.employeeEmail === email ? { ...r, lastNudgedAt: new Date().toISOString() } : r))
      } else {
        setRemindError(`${email} was already reminded in the last 3 days.`)
      }
    } catch (e) {
      setRemindError(e.message)
    }
  }

  return (
    <Page title="My team" subtitle={rows ? `${filtered.length} review${filtered.length === 1 ? '' : 's'}` : undefined}>
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div role="group" aria-label="Show" className="flex gap-2 flex-wrap">
          {[['direct', 'Direct reports'], ['team', 'Whole team']].map(([key, label]) => (
            <button key={key} aria-pressed={view === key} onClick={() => setView(key)}
              className={`px-4 min-h-[44px] rounded-full border text-sm font-semibold ${view === key ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
          Period
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
            <option value="all">All history</option>
            {periods.map(p => <option key={p.key} value={p.key}>{periodLabel(p.kind, p.year, p.quarter)}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="text-red-700">{error}</p>}
      {remindError && <p role="alert" className="text-red-700 mb-3">{remindError}</p>}
      {rows === null && !error && <p className="text-gray-500">Loading…</p>}

      {rows && (
        <>
          <section aria-label="Your team" className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
            <h2 className="text-base font-semibold mb-2">
              {view === 'direct' ? 'Direct reports' : 'Whole team'} ({rosterFiltered.length})
            </h2>
            {rosterFiltered.length === 0 ? (
              <p className="text-sm text-gray-600 m-0">Nobody reports to you yet in the directory.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {rosterFiltered.map(p => (
                  <li key={p.employee_email}
                    className="flex items-center gap-2 border border-gray-200 rounded-full pl-3 pr-2 py-1 text-sm">
                    <span>{p.display_name || p.employee_email}</span>
                    {!p.is_participant && (
                      <span className="bg-amber-100 text-amber-800 text-xs font-semibold rounded-full px-2 py-0.5">Not in reviews yet</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-600 mt-2 mb-0">
              From the directory&rsquo;s reporting line. A review only shows below once someone&rsquo;s added as a
              participant and a cycle is opened for them.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 mb-6">
            {tiles.map(t => (
              <div key={t.status} className="flex-1 min-w-[160px] bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
                <span className="self-start bg-gray-100 text-gray-700 text-xs font-semibold rounded-full px-2.5 py-0.5">{t.label}</span>
                <span className="text-4xl font-bold leading-none">{t.count}</span>
              </div>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Todo>No reviews match this filter.</Todo>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="text-left bg-gray-50">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Person</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Period</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Reports to</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Review</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Goal check-ins</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-600 border-b border-gray-200">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={`${r.employeeEmail}:${periodKey(r.kind, r.year, r.quarter)}`}>
                      <th scope="row" className="px-4 py-3 font-semibold text-left border-b border-gray-100">
                        {r.isDirect
                          ? <Link to={`/team/${encodeURIComponent(r.employeeEmail)}/goals`} state={{ displayName: r.displayName }}>{r.displayName}</Link>
                          : <span>{r.displayName}</span>}
                      </th>
                      <td className="px-4 py-3 text-gray-600 border-b border-gray-100 whitespace-nowrap">{periodLabel(r.kind, r.year, r.quarter)}</td>
                      <td className="px-4 py-3 text-gray-600 border-b border-gray-100">{r.managerName}</td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        <span className="bg-gray-100 text-gray-700 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap">{statusLabel(r.status)}</span>
                      </td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        {r.activeGoals === null ? '—' : `${r.checkedIn} of ${r.activeGoals}`}
                      </td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        <RowAction row={r} onRemind={handleRemind} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-600">
            Click a direct report&rsquo;s name to see their goals. You can open or view any review you manage, past or
            present. For everyone else on your team you see status only, not answers or goals. Each person can be
            reminded once every 3 days.
          </p>
        </>
      )}
    </Page>
  )
}

function RowAction({ row, onRemind }) {
  if (row.status === 'with_manager' && row.reviewId) {
    return (
      <Link to={`/team/${encodeURIComponent(row.employeeEmail)}/review/${row.reviewId}`} state={{ displayName: row.displayName }}
        className="inline-block bg-brand text-white rounded-lg px-4 py-2 text-sm font-semibold">
        Open review
      </Link>
    )
  }
  if (row.status === 'locked' && row.reviewId) {
    return (
      <Link to={`/team/${encodeURIComponent(row.employeeEmail)}/review/${row.reviewId}`} state={{ displayName: row.displayName }}
        className="inline-block bg-white text-brand border border-brand rounded-lg px-4 py-2 text-sm font-semibold">
        View signed record
      </Link>
    )
  }
  if (row.status === 'draft') {
    const remindedRecently = row.lastNudgedAt && (Date.now() - new Date(row.lastNudgedAt).getTime()) < THREE_DAYS_MS
    if (remindedRecently) {
      return <span className="text-sm text-gray-600">Reminded {new Date(row.lastNudgedAt).toLocaleDateString()}</span>
    }
    return (
      <button type="button" onClick={() => onRemind(row.employeeEmail)}
        className="bg-white text-brand border border-brand rounded-lg px-4 py-2 text-sm font-semibold min-h-[44px]">
        Send reminder
      </button>
    )
  }
  return <span className="text-sm text-gray-600">No action needed</span>
}
