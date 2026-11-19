import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Handshake, Heart, Circle, MinusCircle, Clock, CheckCircle2, Bell, Target } from 'lucide-react'
import Page, { Todo } from '../components/Page'
import { teamStatus, teamRoster, teamLastNudge, listReviewIds, listRequiredReviews, requestNudge } from '../lib/rev'
import { fiscalYearOf, fiscalYearLabel } from '../lib/fiscal'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

const QUARTER_COLS = [
  { key: 'q1', label: 'Q1', kind: 'quarterly', quarter: 1 },
  { key: 'q2', label: 'Q2', kind: 'quarterly', quarter: 2 },
  { key: 'q3', label: 'Q3', kind: 'quarterly', quarter: 3 },
  { key: 'annual', label: 'Annual', kind: 'annual', quarter: null },
]
const STAFF_TYPES = [['paid', 'Paid', Briefcase], ['seconded', 'Supported', Handshake], ['volunteer', 'Volunteer', Heart]]
const HOURS_TYPES = [['full_time', 'Full-time'], ['part_time', 'Part-time']]
const STATUS_RANK = { na: 0, future: 1, draft: 2, with_manager: 3, awaiting_employee: 4, locked: 5 }

export default function Team() {
  const currentFy = fiscalYearOf()

  const [roster, setRoster] = useState(null)
  const [statusRows, setStatusRows] = useState([])
  const [reviewIds, setReviewIds] = useState([])
  const [required, setRequired] = useState([])
  const [nudges, setNudges] = useState([])
  const [error, setError] = useState('')
  const [remindError, setRemindError] = useState('')

  const [view, setView] = useState('team') // 'team' | 'direct'
  const [fy, setFy] = useState(currentFy)
  const [hoursFilter, setHoursFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })

  function load() {
    setRoster(null)
    setError('')
    Promise.all([teamRoster(), teamStatus(), listReviewIds(), listRequiredReviews(), teamLastNudge()])
      .then(([rosterRows, status, ids, req, nudgeRows]) => {
        setRoster(rosterRows)
        setStatusRows(status)
        setReviewIds(ids)
        setRequired(req)
        setNudges(nudgeRows)
      })
      .catch(e => setError(e.message))
  }

  useEffect(load, [])

  const requiredByKey = useMemo(
    () => Object.fromEntries(required.map(r => [`${r.hours}:${r.review}`, r.required])),
    [required],
  )
  const nudgeByEmail = useMemo(
    () => Object.fromEntries(nudges.map(n => [n.employee_email, n.last_nudged_at])),
    [nudges],
  )
  const reviewIndex = useMemo(() => {
    const statusByKey = new Map()
    for (const r of statusRows) statusByKey.set(`${r.employee_email}|${r.kind}|${r.period_year}|${r.period_quarter ?? ''}`, r.status)
    const idByKey = new Map()
    for (const r of reviewIds) idByKey.set(`${r.employee_email}|${r.kind}|${r.period_year}|${r.period_quarter ?? ''}`, r.id)
    return { statusByKey, idByKey }
  }, [statusRows, reviewIds])

  function cellFor(person, col) {
    const required_ = requiredByKey[`${person.hours}:${col.key}`]
    if (!person.hours || !required_) return { state: 'na' }
    const idx = `${person.employee_email}|${col.kind}|${fy}|${col.quarter ?? ''}`
    const status = reviewIndex.statusByKey.get(idx)
    if (!status) return { state: 'future' }
    return { state: status, id: reviewIndex.idByKey.get(idx) || null }
  }

  const filteredRoster = useMemo(() => {
    if (!roster) return []
    return roster.filter(p => {
      if (view === 'direct' && !p.is_direct) return false
      if (hoursFilter !== 'all' && p.hours !== hoursFilter) return false
      if (typeFilter !== 'all' && p.worker_type !== typeFilter) return false
      return true
    })
  }, [roster, view, hoursFilter, typeFilter])

  const tableRows = useMemo(
    () => filteredRoster.map(p => ({ ...p, cells: Object.fromEntries(QUARTER_COLS.map(col => [col.key, cellFor(p, col)])) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRoster, requiredByKey, reviewIndex, fy],
  )

  const sorted = useMemo(() => {
    const rows = tableRows.slice()
    const dir = sort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      if (sort.key === 'name') return dir * (a.display_name || a.employee_email).localeCompare(b.display_name || b.employee_email)
      if (sort.key === 'hours') return dir * (a.hours || '').localeCompare(b.hours || '')
      if (sort.key === 'worker_type') return dir * (a.worker_type || '').localeCompare(b.worker_type || '')
      return dir * (STATUS_RANK[a.cells[sort.key].state] - STATUS_RANK[b.cells[sort.key].state])
    })
    return rows
  }, [tableRows, sort])

  function toggleSort(key) {
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  async function handleRemind(email) {
    setRemindError('')
    try {
      const sent = await requestNudge(email)
      if (sent) {
        setNudges(prev => [...prev.filter(n => n.employee_email !== email), { employee_email: email, last_nudged_at: new Date().toISOString() }])
      } else {
        setRemindError(`${email} was already reminded in the last 3 days.`)
      }
    } catch (e) {
      setRemindError(e.message)
    }
  }

  return (
    <Page title="My team" subtitle={roster ? `${sorted.length} ${sorted.length === 1 ? 'person' : 'people'} · ${fiscalYearLabel(fy)}` : undefined}>
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div role="group" aria-label="Show" className="flex gap-2 flex-wrap">
          {[['direct', 'Direct reports'], ['team', 'Whole team']].map(([key, label]) => (
            <button key={key} aria-pressed={view === key} onClick={() => setView(key)}
              className={`px-4 min-h-[44px] rounded-full border text-sm font-semibold ${view === key ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-3 items-end flex-wrap">
          <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
            Fiscal year
            <select value={fy} onChange={e => setFy(Number(e.target.value))}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
              {[currentFy, currentFy - 1, currentFy - 2].map(y => <option key={y} value={y}>FY{y}{y === currentFy ? ' (current)' : ''}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
            Staff type
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
              <option value="all">All</option>
              {STAFF_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
            FTE
            <select value={hoursFilter} onChange={e => setHoursFilter(e.target.value)}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
              <option value="all">All</option>
              {HOURS_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}
      {remindError && <p role="alert" className="text-red-700 mb-3">{remindError}</p>}
      {roster === null && !error && <p className="text-gray-500">Loading…</p>}

      {roster && (
        <>
          {sorted.length === 0 ? (
            <Todo>Nobody matches this filter.</Todo>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left bg-gray-50">
                    <Th label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                    <Th label="FTE" sortKey="hours" sort={sort} onSort={toggleSort} center />
                    <Th label="Staff type" sortKey="worker_type" sort={sort} onSort={toggleSort} center />
                    <th scope="col" className="px-3 py-2 text-xs font-semibold text-gray-600 border-b border-gray-200 text-center">Goals</th>
                    {QUARTER_COLS.map(col => (
                      <Th key={col.key} label={col.label} sortKey={col.key} sort={sort} onSort={toggleSort} center />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(person => {
                    const name = person.display_name || person.employee_email
                    return (
                      <tr key={person.employee_email}>
                        <th scope="row" className="px-3 py-2 font-semibold text-left border-b border-gray-100 whitespace-nowrap">
                          {person.is_direct
                            ? <Link to={`/team/${encodeURIComponent(person.employee_email)}/goals`} state={{ displayName: name }}>{name}</Link>
                            : <span>{name}</span>}
                          {!person.is_participant && (
                            <span className="ml-2 bg-amber-100 text-amber-800 text-[11px] font-semibold rounded-full px-2 py-0.5 align-middle whitespace-nowrap">
                              Not in reviews yet
                            </span>
                          )}
                        </th>
                        <td className="px-3 py-2 border-b border-gray-100 text-center"><FteIcon hours={person.hours} /></td>
                        <td className="px-3 py-2 border-b border-gray-100 text-center"><StaffTypeIcon workerType={person.worker_type} /></td>
                        <td className="px-3 py-2 border-b border-gray-100 text-center"><GoalsCell person={person} name={name} /></td>
                        {QUARTER_COLS.map(col => {
                          const props = reviewCellProps(person, col, person.cells[col.key], name, nudgeByEmail, handleRemind)
                          return <td key={col.key} className="px-3 py-2 border-b border-gray-100 text-center"><IconCell {...props} /></td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <section aria-label="Icon legend" className="mt-4 bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700">
            <LegendItem icon={Circle} iconProps={{ fill: 'currentColor' }} label="Full-time" />
            <LegendItem icon={Circle} label="Part-time" />
            <LegendItem icon={Briefcase} label="Paid" />
            <LegendItem icon={Handshake} label="Supported" />
            <LegendItem icon={Heart} label="Volunteer" />
            <LegendItem icon={MinusCircle} className="text-gray-300" label="Not applicable" />
            <LegendItem icon={Circle} className="text-gray-300" label="Not opened yet" />
            <LegendItem icon={Bell} className="text-amber-600" label="Draft — send a reminder" />
            <LegendItem icon={Clock} className="text-amber-600" label="Waiting on you" />
            <LegendItem icon={Clock} className="text-blue-600" label="Waiting on employee" />
            <LegendItem icon={CheckCircle2} className="text-green-700" label="Completed" />
          </section>

          <p className="mt-3 text-xs text-gray-600">
            Click a direct report&rsquo;s name or goals icon to see their goals. You can open or view any review you
            manage, past or present. For everyone else on your team you see status only, not answers or goals. Each
            person can be reminded once every 3 days.
          </p>
        </>
      )}
    </Page>
  )
}

function Th({ label, sortKey, sort, onSort, center }) {
  const active = sort.key === sortKey
  return (
    <th scope="col" className={`px-3 py-2 text-xs font-semibold text-gray-600 border-b border-gray-200 ${center ? 'text-center' : ''}`}>
      <button type="button" onClick={() => onSort(sortKey)} className={`flex items-center gap-1 ${center ? 'mx-auto' : ''}`}>
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function iconCellClasses() {
  return 'inline-flex items-center justify-center w-9 h-9 rounded-lg'
}

function IconCell({ icon: Icon, className, title, to, linkState, onClick }) {
  const content = <Icon size={18} className={className} aria-hidden="true" />
  if (to) {
    return (
      <Link to={to} state={linkState} title={title} aria-label={title} className={`${iconCellClasses()} hover:bg-gray-100`}>
        {content}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-label={title} className={`${iconCellClasses()} hover:bg-gray-100`}>
        {content}
      </button>
    )
  }
  return <span title={title} aria-label={title} className={iconCellClasses()}>{content}</span>
}

function reviewCellProps(person, col, cell, name, nudgeByEmail, onRemind) {
  const email = person.employee_email
  const linkTo = cell.id ? `/team/${encodeURIComponent(email)}/review/${cell.id}` : null
  const linkState = { displayName: name }

  if (cell.state === 'na') return { icon: MinusCircle, className: 'text-gray-300', title: `${col.label}: not applicable for ${name}` }
  if (cell.state === 'future') return { icon: Circle, className: 'text-gray-300', title: `${col.label}: not opened yet` }

  if (cell.state === 'draft') {
    const lastNudged = nudgeByEmail[email]
    const remindedRecently = lastNudged && (Date.now() - new Date(lastNudged).getTime()) < THREE_DAYS_MS
    if (remindedRecently) {
      return { icon: Bell, className: 'text-gray-400', title: `${col.label}: reminded ${new Date(lastNudged).toLocaleDateString()}` }
    }
    return { icon: Bell, className: 'text-amber-600', title: `${col.label}: draft — send ${name} a reminder`, onClick: () => onRemind(email) }
  }
  if (cell.state === 'with_manager') {
    return linkTo
      ? { icon: Clock, className: 'text-amber-600', title: `${col.label}: waiting on you`, to: linkTo, linkState }
      : { icon: Clock, className: 'text-amber-600', title: `${col.label}: with ${name}'s manager` }
  }
  if (cell.state === 'awaiting_employee') {
    return linkTo
      ? { icon: Clock, className: 'text-blue-600', title: `${col.label}: waiting on ${name} to sign off`, to: linkTo, linkState }
      : { icon: Clock, className: 'text-blue-600', title: `${col.label}: waiting on ${name} to sign off` }
  }
  // locked
  return linkTo
    ? { icon: CheckCircle2, className: 'text-green-700', title: `${col.label}: completed — view signed record`, to: linkTo, linkState }
    : { icon: CheckCircle2, className: 'text-green-700', title: `${col.label}: completed` }
}

function FteIcon({ hours }) {
  if (!hours) return <span title="Hours not set" aria-label="Hours not set" className="inline-flex items-center justify-center w-9 h-9 text-gray-300"><Circle size={14} /></span>
  const full = hours === 'full_time'
  const label = full ? 'Full-time' : 'Part-time'
  return (
    <span title={label} aria-label={label} className="inline-flex items-center justify-center w-9 h-9 text-gray-600">
      <Circle size={14} fill={full ? 'currentColor' : 'none'} />
    </span>
  )
}

function StaffTypeIcon({ workerType }) {
  const entry = STAFF_TYPES.find(([k]) => k === workerType)
  if (!entry) return <span title="Staff type not set" aria-label="Staff type not set" className="inline-flex items-center justify-center w-9 h-9 text-gray-300"><MinusCircle size={14} /></span>
  const [, label, Icon] = entry
  return <span title={label} aria-label={label} className="inline-flex items-center justify-center w-9 h-9 text-gray-600"><Icon size={16} /></span>
}

function GoalsCell({ person, name }) {
  if (!person.is_direct) {
    return (
      <span title="Only visible for direct reports" aria-label="Goals not visible" className="inline-flex items-center justify-center w-9 h-9 text-gray-300">
        <Target size={16} />
      </span>
    )
  }
  return (
    <Link to={`/team/${encodeURIComponent(person.employee_email)}/goals`} state={{ displayName: name }}
      title={`View ${name}'s goals`} aria-label={`View ${name}'s goals`}
      className={`${iconCellClasses()} text-brand hover:bg-gray-100`}>
      <Target size={16} />
    </Link>
  )
}

function LegendItem({ icon: Icon, className, iconProps, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon size={16} className={className || 'text-gray-600'} {...iconProps} />
      {label}
    </span>
  )
}
