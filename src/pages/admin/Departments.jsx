import { useEffect, useState } from 'react'
import Page, { Todo } from '../../components/Page'
import { useRev } from '../../context/RevContext'
import {
  listDepartments, createDepartment, updateDepartment,
  listParticipants, listProfiles, assignParticipantDepartment,
} from '../../lib/rev'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function AdminDepartments() {
  const rev = useRev()
  const [depts, setDepts] = useState(null)
  const [participants, setParticipants] = useState(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState('')
  const [adding, setAdding] = useState(false)

  function load() {
    setError('')
    Promise.all([listDepartments(), listParticipants()])
      .then(async ([deptRows, participantRows]) => {
        const emails = participantRows.map(p => p.email)
        const profiles = emails.length ? await listProfiles(emails) : []
        const byEmail = Object.fromEntries(profiles.map(p => [p.primary_email.toLowerCase(), p.display_name]))
        setDepts(deptRows)
        setParticipants(participantRows.map(p => ({ ...p, display_name: byEmail[p.email] || null })))
      })
      .catch(e => setError(e.message))
  }

  useEffect(() => { if (rev.ready && rev.superAdmin) load() }, [rev.ready, rev.superAdmin])

  async function handleSetHead(id, raw) {
    const email = raw.trim().toLowerCase()
    if (email && !EMAIL_RE.test(email)) { setError('Enter a valid email address for the head, or clear it.'); load(); return }
    setDepts(ds => ds.map(d => (d.id === id ? { ...d, head_email: email || null, source: 'manual' } : d)))
    try {
      await updateDepartment(id, { headEmail: email })
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  async function handleSetParent(id, parentId) {
    setDepts(ds => ds.map(d => (d.id === id ? { ...d, parent_id: parentId || null, source: 'manual' } : d)))
    try {
      await updateDepartment(id, { parentId })
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    setError('')
    try {
      await createDepartment(newName, newParentId || null)
      setNewName('')
      setNewParentId('')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setAdding(false)
    }
  }

  async function handleAssign(email, departmentId) {
    setParticipants(ps => ps.map(p => (p.email === email ? { ...p, department_id: departmentId } : p)))
    try {
      await assignParticipantDepartment(email, departmentId)
    } catch (e) {
      setError(e.message)
      load()
    }
  }

  if (!rev.ready) return <Page title="Departments"><p className="text-gray-500">Loading…</p></Page>
  if (!rev.superAdmin) return <Page title="Departments"><Todo>You need super admin access to manage departments.</Todo></Page>

  const kids = id => (depts || []).filter(d => (d.parent_id || null) === (id || null))
  function subtreeIds(id) {
    return [id, ...kids(id).flatMap(k => subtreeIds(k.id))]
  }
  function rollupCount(id) {
    const ids = new Set(subtreeIds(id))
    return (participants || []).filter(p => p.department_id && ids.has(p.department_id)).length
  }

  const order = []
  function walk(parentId, depth) {
    kids(parentId).slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(d => { order.push({ d, depth }); walk(d.id, depth + 1) })
  }
  if (depts) walk(null, 0)

  const unassigned = (participants || []).filter(p => !p.department_id)

  return (
    <Page title="Departments"
      subtitle="Fix the structure if the import got it wrong. Heads see everything beneath them, read-only. Only super admins can change this screen.">
      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}

      <section aria-labelledby="structure" className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
        <h2 id="structure" className="text-lg font-semibold m-0">Structure</h2>

        {depts === null && !error && <p className="text-gray-500">Loading…</p>}
        {depts && depts.length === 0 && <Todo>No departments yet. Add one below.</Todo>}

        <div className="flex flex-col gap-2.5">
          {order.map(({ d, depth }) => {
            const bad = new Set(subtreeIds(d.id))
            const parentOptions = (depts || []).filter(x => !bad.has(x.id))
            const count = rollupCount(d.id)
            return (
              <div key={d.id} style={{ marginLeft: depth * 24 }}
                className={`border border-gray-200 rounded-lg p-3.5 flex flex-wrap gap-3 items-end ${depth === 0 ? 'border-l-4 border-l-brand' : 'border-l-4 border-l-gray-300'}`}>
                <div className="flex-1 min-w-[160px]">
                  <div className="font-semibold text-[15px]">{d.name}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {count} {count === 1 ? 'person' : 'people'} ·{' '}
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${d.source === 'import' ? 'bg-gray-200 text-gray-700' : 'bg-blue-100 text-blue-900'}`}>
                      {d.source === 'import' ? 'Imported' : 'Added by hand'}
                    </span>
                  </div>
                </div>
                <label className="flex-1 min-w-[160px] flex flex-col gap-1 text-xs font-semibold">
                  Head
                  <input type="email" defaultValue={d.head_email || ''} placeholder="name@sil.org"
                    onBlur={e => handleSetHead(d.id, e.target.value)}
                    className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal text-sm" />
                </label>
                <label className="flex-1 min-w-[160px] flex flex-col gap-1 text-xs font-semibold">
                  Sits under
                  <select value={d.parent_id || ''} onChange={e => handleSetParent(d.id, e.target.value)}
                    className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-sm">
                    <option value="">Top level</option>
                    {parentOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
              </div>
            )
          })}
        </div>

        <form onSubmit={handleAdd} className="border-t border-gray-200 pt-3.5 flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-sm font-semibold">
            New department
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name"
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
          </label>
          <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-sm font-semibold">
            Sits under
            <select value={newParentId} onChange={e => setNewParentId(e.target.value)}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
              <option value="">Top level</option>
              {(depts || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={adding || !newName.trim()}
            className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60">
            {adding ? 'Adding…' : 'Add department'}
          </button>
        </form>
        <p className="text-xs text-gray-600 m-0">
          A department can&rsquo;t be moved inside itself. Departments with people in them aren&rsquo;t deleted; move the people first.
        </p>
      </section>

      <section aria-labelledby="unassigned"
        className={`bg-white border rounded-xl p-5 mt-6 flex flex-col gap-2.5 ${unassigned.length ? 'border-amber-400' : 'border-gray-200'}`}>
        <h2 id="unassigned" className="text-lg font-semibold m-0">People without a department ({unassigned.length})</h2>
        {unassigned.length === 0 && <p className="text-sm text-gray-600 m-0">Everyone is in a department.</p>}
        {unassigned.map(p => (
          <div key={p.email} className="flex flex-wrap gap-3 items-center justify-between">
            <span className="text-[15px]">{p.display_name || p.email}</span>
            <label className="sr-only" htmlFor={`assign-${p.email}`}>Assign {p.display_name || p.email} to a department</label>
            <select id={`assign-${p.email}`} value="" onChange={e => e.target.value && handleAssign(p.email, e.target.value)}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-sm">
              <option value="">Assign to…</option>
              {(depts || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        ))}
      </section>
    </Page>
  )
}
