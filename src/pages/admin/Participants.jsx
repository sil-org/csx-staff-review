import { useEffect, useRef, useState } from 'react'
import Page, { Todo } from '../../components/Page'
import { useAuth } from '../../context/AuthContext'
import { useRev } from '../../context/RevContext'
import { listParticipants, searchProfiles, findProfile, addParticipant, updateParticipant, removeParticipant, listProfiles } from '../../lib/rev'

const WORKER_TYPES = [['paid', 'Paid'], ['seconded', 'Seconded'], ['volunteer', 'Volunteers']]
const HOURS = [['full_time', 'Full-time'], ['part_time', 'Part-time']]

export default function AdminParticipants() {
  const { profile } = useAuth()
  const rev = useRev()
  const [participants, setParticipants] = useState(null)
  const [error, setError] = useState('')

  // Admin sees every participant in the organization, not just a slice of it — unlike a
  // department head, who only ever sees their own department and below. Listed here with
  // their manager (from the directory, not a department) so admin can spot who has nobody
  // on file to review them.
  function load() {
    setError('')
    listParticipants()
      .then(async rows => {
        const emails = rows.map(r => r.email)
        const profiles = emails.length ? await listProfiles(emails) : []
        const byEmail = Object.fromEntries(profiles.map(p => [p.primary_email.toLowerCase(), p]))
        const managerEmails = [...new Set(profiles.map(p => p.manager_email).filter(Boolean))]
          .filter(e => !byEmail[e.toLowerCase()])
        const managerProfiles = managerEmails.length ? await listProfiles(managerEmails) : []
        managerProfiles.forEach(p => { byEmail[p.primary_email.toLowerCase()] = p })
        setParticipants(rows.map(r => {
          const prof = byEmail[r.email]
          const managerEmail = prof?.manager_email || null
          const managerProf = managerEmail ? byEmail[managerEmail.toLowerCase()] : null
          return {
            ...r,
            display_name: prof?.display_name || null,
            manager_email: managerEmail,
            manager_name: managerProf?.display_name || null,
            is_contingent: prof?.employee_type === 'contingent',
          }
        }))
      })
      .catch(e => setError(e.message))
  }

  useEffect(() => { if (rev.ready && rev.admin) load() }, [rev.ready, rev.admin])

  async function handleAdd(email, hours, workerType) {
    const clean = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email address')
    if ((participants || []).some(p => p.email === clean)) throw new Error(`${clean} is already a participant`)
    const matched = await findProfile(clean).catch(() => null)
    await addParticipant(clean, { hours, workerType }, profile.primary_email)
    load()
    if (matched?.employee_type === 'contingent') {
      return `Added ${clean}. They're a contingent worker, so they'll never be sent a review, no matter the hours/worker type set here.`
    }
    if (matched && matched.manager_email) return null
    return `Added ${clean}. ${matched ? 'No manager is on file for them yet' : "They aren't in the directory yet"} — they won't be able to submit a review until that's set.`
  }

  async function handleUpdate(email, fields) {
    setParticipants(ps => ps.map(p => (p.email === email ? { ...p, ...fields } : p)))
    try {
      await updateParticipant(email, { hours: fields.hours, workerType: fields.worker_type })
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  async function handleRemove(email) {
    setParticipants(ps => ps.filter(p => p.email !== email))
    try {
      await removeParticipant(email)
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  if (!rev.ready) {
    return <Page title="Participants"><p className="text-gray-500">Loading…</p></Page>
  }
  if (!rev.admin) {
    return <Page title="Participants"><Todo>You need admin access to manage participants.</Todo></Page>
  }

  const counts = (participants || []).reduce((acc, p) => {
    acc.worker[p.worker_type] = (acc.worker[p.worker_type] || 0) + 1
    acc.hours[p.hours] = (acc.hours[p.hours] || 0) + 1
    return acc
  }, { worker: {}, hours: {} })

  return (
    <Page title="Participants"
      subtitle="Only people listed here get reviews. Their hours decide which reviews they must have, their worker type which questions they are asked.">
      {participants && (
        <p className="text-sm text-gray-600 mb-3">
          {participants.length} people: {counts.worker.paid || 0} paid, {counts.worker.seconded || 0} seconded, {counts.worker.volunteer || 0} volunteers.{' '}
          {counts.hours.full_time || 0} full-time, {counts.hours.part_time || 0} part-time.
        </p>
      )}

      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}

      <section aria-labelledby="part" className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 id="part" className="sr-only">Participants</h2>

        <AddParticipantForm onAdd={handleAdd} />

        {participants === null && !error && <p className="text-gray-500">Loading…</p>}
        {participants && participants.length === 0 && <Todo>No participants yet. Add someone above.</Todo>}

        {participants && participants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[15px]">
              <thead>
                <tr className="text-left bg-gray-50">
                  <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Person</th>
                  <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Manager</th>
                  <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Worker type</th>
                  <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Hours</th>
                  <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {participants.map(p => (
                  <tr key={p.email}>
                    <th scope="row" className="px-3 py-1.5 text-left font-semibold border-b border-gray-100">
                      {p.display_name || p.email}
                      {p.is_contingent && (
                        <span className="ml-2 bg-gray-200 text-gray-700 text-[11px] font-semibold rounded-full px-2 py-0.5 align-middle whitespace-nowrap">
                          Contingent — no reviews
                        </span>
                      )}
                      {p.display_name && <div className="text-xs font-normal text-gray-500">{p.email}</div>}
                    </th>
                    <td className="px-3 py-1.5 border-b border-gray-100 text-gray-700">
                      {p.manager_name || p.manager_email || <span className="text-amber-800">None on file</span>}
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100">
                      <label className="sr-only" htmlFor={`w-${p.email}`}>Worker type for {p.display_name || p.email}</label>
                      <select id={`w-${p.email}`} value={p.worker_type} disabled={p.is_contingent}
                        title={p.is_contingent ? 'Contingent workers never get reviews, regardless of this setting' : undefined}
                        onChange={e => handleUpdate(p.email, { worker_type: e.target.value })}
                        className="border border-gray-400 rounded-lg px-3 py-1.5 min-h-[44px] bg-white font-normal disabled:opacity-50 disabled:bg-gray-100">
                        {WORKER_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100">
                      <label className="sr-only" htmlFor={`h-${p.email}`}>Hours for {p.display_name || p.email}</label>
                      <select id={`h-${p.email}`} value={p.hours} disabled={p.is_contingent}
                        title={p.is_contingent ? 'Contingent workers never get reviews, regardless of this setting' : undefined}
                        onChange={e => handleUpdate(p.email, { hours: e.target.value })}
                        className="border border-gray-400 rounded-lg px-3 py-1.5 min-h-[44px] bg-white font-normal disabled:opacity-50 disabled:bg-gray-100">
                        {HOURS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 border-b border-gray-100 text-right">
                      <button type="button" onClick={() => handleRemove(p.email)}
                        className="bg-white text-red-800 border border-red-800 rounded-lg px-3 py-1.5 text-sm font-semibold min-h-[44px]">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  )
}

function AddParticipantForm({ onAdd }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [hours, setHours] = useState('full_time')
  const [workerType, setWorkerType] = useState('paid')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    setPicked(p => (p && p.primary_email === query ? p : null))
    clearTimeout(timer.current)
    if (query.trim().length < 2) { setSuggestions([]); return }
    timer.current = setTimeout(() => {
      searchProfiles(query).then(setSuggestions).catch(() => setSuggestions([]))
    }, 250)
    return () => clearTimeout(timer.current)
  }, [query])

  async function handleAdd(e) {
    e.preventDefault()
    setError('')
    setWarning('')
    setAdding(true)
    try {
      const warn = await onAdd(query, hours, workerType)
      setQuery('')
      setPicked(null)
      setSuggestions([])
      if (warn) setWarning(warn)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <form onSubmit={handleAdd} className="flex flex-col gap-2 mb-5">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-[2_1_220px] min-w-[220px] flex flex-col gap-1 relative">
          <label htmlFor="participant-email" className="text-sm font-semibold">Add by email</label>
          <input id="participant-email" type="email" required value={query} autoComplete="off"
            onChange={e => setQuery(e.target.value)} placeholder="name@sil.org"
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
          {suggestions.length > 0 && !picked && (
            <ul className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-md z-10 max-h-56 overflow-auto">
              {suggestions.map(s => (
                <li key={s.primary_email}>
                  <button type="button"
                    onClick={() => { setQuery(s.primary_email); setPicked(s); setSuggestions([]) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100">
                    <div className="font-semibold">{s.display_name || s.primary_email}</div>
                    {s.display_name && <div className="text-gray-500 text-xs">{s.primary_email}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-sm font-semibold">
          Worker type
          <select value={workerType} onChange={e => setWorkerType(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
            {WORKER_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="flex-1 min-w-[130px] flex flex-col gap-1 text-sm font-semibold">
          Hours
          <select value={hours} onChange={e => setHours(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
            {HOURS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <button type="submit" disabled={adding || !query.trim()}
          className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60">
          {adding ? 'Adding…' : 'Add person'}
        </button>
      </div>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {warning && <p role="status" className="text-amber-800 text-sm">{warning}</p>}
    </form>
  )
}
