import { useEffect, useRef, useState } from 'react'
import Page, { Todo } from '../../components/Page'
import { useAuth } from '../../context/AuthContext'
import { useRev } from '../../context/RevContext'
import {
  activeTemplate, createTemplate, listQuestions, saveQuestions,
  cyclePreview, openCycle, cycleHistory, listRequiredReviews, setRequiredReview, getSettings, updateSettings,
  listParticipants, searchProfiles, findProfile, addParticipant, updateParticipant, removeParticipant, listProfiles,
} from '../../lib/rev'
import { fiscalYearOf, fiscalQuarterOf } from '../../lib/fiscal'

const TYPES = [['paragraph', 'Paragraph'], ['short_text', 'Short text'], ['select', 'Select (dropdown)']]
const WORKER_TYPES = [['paid', 'Paid'], ['seconded', 'Seconded'], ['volunteer', 'Volunteers']]
const ALL_WORKER_TYPES = WORKER_TYPES.map(([k]) => k)
const HOURS = [['full_time', 'Full-time'], ['part_time', 'Part-time']]
const REVIEW_KEYS = [['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4'], ['annual', 'Annual']]

// Two fiscal years' worth of cycles to pick from when opening one.
function cycleOptions(fy) {
  const opts = []
  for (const y of [fy, fy - 1]) {
    for (let q = 1; q <= 4; q++) opts.push({ key: `quarterly:${y}:${q}`, label: `Q${q} FY${y}`, kind: 'quarterly', year: y, quarter: q })
    opts.push({ key: `annual:${y}`, label: `Annual FY${y}`, kind: 'annual', year: y, quarter: null })
  }
  return opts
}

function cycleLabel(c) {
  return c.period_quarter ? `Q${c.period_quarter} FY${c.period_year}` : `Annual FY${c.period_year}`
}

const optionLines = text => text.split('\n').map(s => s.trim()).filter(Boolean)

function fromRow(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    type: row.type,
    required: row.required,
    optionsText: (row.options || []).join('\n'),
    worker_types: row.worker_types,
  }
}

function newQuestion() {
  return { id: crypto.randomUUID(), prompt: '', type: 'paragraph', required: false, optionsText: '', worker_types: ALL_WORKER_TYPES }
}

export default function AdminQuestions() {
  const { profile } = useAuth()
  const rev = useRev()
  const [kind, setKind] = useState('quarterly')
  const [templateId, setTemplateId] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [removedIds, setRemovedIds] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [error, setError] = useState('')

  function load() {
    setError('')
    setQuestions(null)
    setSavedMessage('')
    activeTemplate(kind)
      .then(t => t || createTemplate(kind, kind === 'quarterly' ? 'Quarterly review questions' : 'Annual review questions', profile.primary_email))
      .then(async t => {
        const rows = await listQuestions(t.id)
        setTemplateId(t.id)
        setQuestions(rows.map(fromRow))
        setRemovedIds([])
        setEditingId(null)
        setDirty(false)
      })
      .catch(e => setError(e.message))
  }

  useEffect(() => { if (rev.ready && rev.admin) load() }, [kind, rev.ready, rev.admin])

  // --- participants ---
  const [participants, setParticipants] = useState(null)
  const [partError, setPartError] = useState('')

  function loadParticipants() {
    setPartError('')
    listParticipants()
      .then(async rows => {
        const emails = rows.map(r => r.email)
        const profiles = emails.length ? await listProfiles(emails) : []
        const byEmail = Object.fromEntries(profiles.map(p => [p.primary_email.toLowerCase(), p.display_name]))
        setParticipants(rows.map(r => ({ ...r, display_name: byEmail[r.email] || null })))
      })
      .catch(e => setPartError(e.message))
  }

  useEffect(() => { if (rev.ready && rev.admin) loadParticipants() }, [rev.ready, rev.admin])

  async function handleAddParticipant(email, hours, workerType) {
    const clean = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email address')
    if ((participants || []).some(p => p.email === clean)) throw new Error(`${clean} is already a participant`)
    const matched = await findProfile(clean).catch(() => null)
    await addParticipant(clean, { hours, workerType }, profile.primary_email)
    loadParticipants()
    if (matched && matched.manager_email) return null
    return `Added ${clean}. ${matched ? 'No manager is on file for them yet' : "They aren't in the directory yet"} — they won't be able to submit a review until that's set.`
  }

  async function handleUpdateParticipant(email, fields) {
    setParticipants(ps => ps.map(p => (p.email === email ? { ...p, ...fields } : p)))
    try {
      await updateParticipant(email, { hours: fields.hours, workerType: fields.worker_type })
    } catch (e) {
      setPartError(e.message)
      loadParticipants()
    }
  }

  async function handleRemoveParticipant(email) {
    setParticipants(ps => ps.filter(p => p.email !== email))
    try {
      await removeParticipant(email)
    } catch (e) {
      setPartError(e.message)
      loadParticipants()
    }
  }

  // --- required reviews & settings ---
  const [required, setRequired] = useState(null)
  const [reqError, setReqError] = useState('')
  const [settings, setSettings] = useState(null)
  const [settingsError, setSettingsError] = useState('')
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')

  function loadRequiredReviews() {
    setReqError('')
    listRequiredReviews().then(setRequired).catch(e => setReqError(e.message))
  }
  function loadSettings() {
    setSettingsError('')
    getSettings().then(setSettings).catch(e => setSettingsError(e.message))
  }
  function loadHistory() {
    setHistoryError('')
    cycleHistory().then(setHistory).catch(e => setHistoryError(e.message))
  }

  useEffect(() => {
    if (!rev.ready || !rev.admin) return
    loadRequiredReviews()
    loadSettings()
    loadHistory()
  }, [rev.ready, rev.admin])

  function toggleRequired(hours, review, value) {
    setRequired(rs => rs.map(r => (r.hours === hours && r.review === review ? { ...r, required: value } : r)))
    setRequiredReview(hours, review, value).catch(e => { setReqError(e.message); loadRequiredReviews() })
  }

  function toggleSkipQ4(checked) {
    setSettings(s => ({ ...s, skip_q4_review: checked }))
    updateSettings({ skip_q4_review: checked }).catch(e => { setSettingsError(e.message); loadSettings() })
  }

  function handleReminderDayChange(value) {
    setSettings(s => ({ ...s, reminder_day_of_month: value === '' ? '' : Number(value) }))
  }

  function handleReminderDayBlur(value) {
    const day = Number(value)
    if (!Number.isInteger(day) || day < 1 || day > 28) { loadSettings(); return }
    updateSettings({ reminder_day_of_month: day }).catch(e => { setSettingsError(e.message); loadSettings() })
  }

  // --- open a cycle ---
  const cycleOpts = cycleOptions(fiscalYearOf())
  const [cycleKey, setCycleKey] = useState(() => `quarterly:${fiscalYearOf()}:${fiscalQuarterOf()}`)
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [opening, setOpening] = useState(false)
  const [openMessage, setOpenMessage] = useState('')

  useEffect(() => {
    if (!rev.ready || !rev.admin) return
    const opt = cycleOpts.find(o => o.key === cycleKey)
    if (!opt) return
    setPreview(null)
    setPreviewError('')
    cyclePreview(opt.kind, opt.year, opt.quarter)
      .then(rows => setPreview(rows[0] || null))
      .catch(e => setPreviewError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleKey, rev.ready, rev.admin])

  async function handleOpenCycle(opt) {
    setOpening(true)
    setOpenMessage('')
    setPreviewError('')
    try {
      const count = await openCycle(opt.kind, opt.year, opt.quarter)
      setOpenMessage(`Opened ${count} review${count === 1 ? '' : 's'}.`)
      loadHistory()
      const rows = await cyclePreview(opt.kind, opt.year, opt.quarter)
      setPreview(rows[0] || null)
    } catch (e) {
      setPreviewError(e.message)
    } finally {
      setOpening(false)
    }
  }

  function patch(id, fields) {
    setQuestions(qs => qs.map(q => (q.id === id ? { ...q, ...fields } : q)))
    setDirty(true)
    setSavedMessage('')
  }

  function move(index, dir) {
    setQuestions(qs => {
      const to = index + dir
      if (to < 0 || to >= qs.length) return qs
      const next = qs.slice()
      const [item] = next.splice(index, 1)
      next.splice(to, 0, item)
      return next
    })
    setDirty(true)
    setSavedMessage('')
  }

  function addQuestion() {
    const q = newQuestion()
    setQuestions(qs => (qs || []).concat([q]))
    setEditingId(q.id)
    setDirty(true)
    setSavedMessage('')
  }

  function removeQuestion(id) {
    setQuestions(qs => qs.filter(q => q.id !== id))
    setRemovedIds(ids => ids.concat([id]))
    if (editingId === id) setEditingId(null)
    setDirty(true)
    setSavedMessage('')
  }

  function toggleWorkerType(q, key) {
    const has = q.worker_types.includes(key)
    const next = ALL_WORKER_TYPES.filter(k => (k === key ? !has : q.worker_types.includes(k)))
    if (next.length === 0) return
    patch(q.id, { worker_types: next })
  }

  async function handleSave() {
    for (const q of questions) {
      if (!q.prompt.trim()) { setError('Every question needs its text filled in.'); return }
      if (q.type === 'select' && optionLines(q.optionsText).length === 0) {
        setError(`"${q.prompt}" needs at least one choice since it's a select question.`)
        return
      }
    }
    setSaving(true)
    setError('')
    try {
      const payload = questions.map(q => ({ ...q, options: optionLines(q.optionsText) }))
      await saveQuestions(templateId, payload, removedIds)
      setSavedMessage('Saved. New reviews will use these questions.')
      setDirty(false)
      setRemovedIds([])
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!rev.ready) {
    return <Page title="Questions & cycles"><p className="text-gray-500">Loading…</p></Page>
  }
  if (!rev.admin) {
    return <Page title="Questions & cycles"><Todo>You need admin access to manage review questions.</Todo></Page>
  }

  return (
    <Page title="Questions & cycles" subtitle="Set the questions, then open a cycle to create a review for every participant.">
      <div role="group" aria-label="Review kind" className="flex gap-2 flex-wrap mb-4">
        {[['quarterly', 'Quarterly'], ['annual', 'Annual']].map(([key, label]) => (
          <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key)}
            className={`px-4 min-h-[44px] rounded-lg border text-sm font-semibold ${kind === key ? 'bg-brand text-white border-brand' : 'bg-white text-gray-700 border-gray-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}

      <section aria-labelledby="qhead" className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-1">
          <h2 id="qhead" className="text-lg font-semibold m-0">{kind === 'quarterly' ? 'Quarterly' : 'Annual'} review questions</h2>
          <span className="bg-green-100 text-green-800 text-xs font-semibold rounded-full px-2.5 py-0.5">Active template</span>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Changes apply to reviews opened after you save. Reviews already open keep the questions they started with.
        </p>

        {questions === null && !error && <p className="text-gray-500">Loading…</p>}
        {questions && questions.length === 0 && <Todo>No questions yet. Add one below.</Todo>}

        <div className="flex flex-col gap-3">
          {(questions || []).map((q, i) => (
            <QuestionCard key={q.id} q={q} index={i} count={questions.length}
              editing={editingId === q.id}
              onToggleEdit={() => setEditingId(editingId === q.id ? null : q.id)}
              onMove={dir => move(i, dir)}
              onRemove={() => removeQuestion(q.id)}
              onPatch={fields => patch(q.id, fields)}
              onToggleWorkerType={key => toggleWorkerType(q, key)}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center mt-4">
          <button type="button" onClick={addQuestion}
            className="bg-white text-brand border border-brand rounded-lg px-4 min-h-[44px] text-sm font-semibold">
            Add a question
          </button>
          <button type="button" disabled={saving || !dirty || !questions} onClick={handleSave}
            className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {savedMessage && <span role="status" className="text-sm text-green-800">{savedMessage}</span>}
        </div>
      </section>

      <OpenCycleCard opts={cycleOpts} cycleKey={cycleKey}
        onChangeKey={key => { setCycleKey(key); setOpenMessage('') }}
        preview={preview} previewError={previewError} opening={opening} openMessage={openMessage}
        settings={settings} onOpen={handleOpenCycle} />

      <RequiredReviewsSection required={required} error={reqError} onToggle={toggleRequired} />

      <SettingsSection settings={settings} error={settingsError}
        onToggleSkipQ4={toggleSkipQ4} onReminderDayChange={handleReminderDayChange} onReminderDayBlur={handleReminderDayBlur} />

      <CycleHistorySection history={history} error={historyError} />

      <ParticipantsSection participants={participants} error={partError}
        onAdd={handleAddParticipant} onUpdate={handleUpdateParticipant} onRemove={handleRemoveParticipant} />
    </Page>
  )
}

function OpenCycleCard({ opts, cycleKey, onChangeKey, preview, previewError, opening, openMessage, settings, onOpen }) {
  const opt = opts.find(o => o.key === cycleKey) || opts[0]
  const blocked = opt.kind === 'quarterly' && opt.quarter === 4 && settings?.skip_q4_review

  let note = ''
  if (blocked) {
    note = 'Q4 reviews are turned off in settings below. Turn that off to open one.'
  } else if (preview) {
    const totalPeople = preview.eligible + preview.not_required + preview.already_open
    if (preview.eligible === 0 && preview.already_open > 0) {
      note = 'This cycle is already open for everyone who needs it.'
    } else {
      note = `${preview.eligible} of ${totalPeople} people need a ${opt.label} review.`
      if (preview.not_required > 0) {
        note += ` ${preview.not_required} ${preview.not_required === 1 ? 'person is' : 'people are'} not required to have one, based on their hours.`
      }
    }
  }

  const disabled = opening || blocked || !preview || preview.eligible === 0
  const buttonLabel = opening ? 'Opening…' : blocked ? 'Q4 is turned off' : (preview && preview.eligible === 0 ? 'Nothing to open' : `Open ${opt.label} reviews for ${preview?.eligible ?? 0}`)

  return (
    <section aria-labelledby="open" className="bg-white border border-gray-200 rounded-xl p-5 mt-6 flex flex-col gap-3">
      <h2 id="open" className="text-lg font-semibold m-0">Open a review cycle</h2>
      <label className="flex flex-col gap-1 text-sm font-semibold max-w-[260px]">
        Cycle
        <select value={cycleKey} onChange={e => onChangeKey(e.target.value)}
          className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
          {opts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      {previewError && <p role="alert" className="text-red-700 text-sm">{previewError}</p>}
      {!previewError && <p className="text-sm text-gray-600 m-0">{preview ? note : 'Loading…'}</p>}
      <button type="button" disabled={disabled} onClick={() => onOpen(opt)}
        className={`self-start rounded-lg px-4 min-h-[44px] text-sm font-semibold text-white disabled:opacity-60 ${disabled ? 'bg-gray-500' : 'bg-brand'}`}>
        {buttonLabel}
      </button>
      {openMessage && <span role="status" className="text-sm text-green-800">{openMessage}</span>}
    </section>
  )
}

function RequiredReviewsSection({ required, error, onToggle }) {
  return (
    <section aria-labelledby="req" className="bg-white border border-gray-200 rounded-xl p-5 mt-6 flex flex-col gap-3">
      <h2 id="req" className="text-lg font-semibold m-0">Required reviews</h2>
      <p className="text-sm text-gray-600 m-0">
        Which reviews each person must have, based on their hours. Opening a cycle creates reviews only for people it&rsquo;s required for.
      </p>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {required === null && !error && <p className="text-gray-500">Loading…</p>}
      {required && (
        <table className="w-full border-collapse text-[15px]">
          <thead>
            <tr className="text-left">
              <th scope="col" className="py-1.5 px-1 text-xs text-gray-600 font-semibold">Review</th>
              <th scope="col" className="py-1.5 px-1 text-xs text-gray-600 font-semibold text-center">Full-time</th>
              <th scope="col" className="py-1.5 px-1 text-xs text-gray-600 font-semibold text-center">Part-time</th>
            </tr>
          </thead>
          <tbody>
            {REVIEW_KEYS.map(([key, label]) => {
              const ft = required.find(r => r.hours === 'full_time' && r.review === key)
              const pt = required.find(r => r.hours === 'part_time' && r.review === key)
              return (
                <tr key={key}>
                  <th scope="row" className="py-0.5 px-1 text-left font-semibold border-t border-gray-100">{label}</th>
                  <td className="py-0.5 px-1 text-center border-t border-gray-100">
                    <input type="checkbox" checked={!!ft?.required} onChange={e => onToggle('full_time', key, e.target.checked)}
                      aria-label={`${label} review required for full-time`} className="w-5 h-5" />
                  </td>
                  <td className="py-0.5 px-1 text-center border-t border-gray-100">
                    <input type="checkbox" checked={!!pt?.required} onChange={e => onToggle('part_time', key, e.target.checked)}
                      aria-label={`${label} review required for part-time`} className="w-5 h-5" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="text-xs text-gray-600 m-0">Q4 stays off for everyone while the Q4 setting below is on.</p>
    </section>
  )
}

function SettingsSection({ settings, error, onToggleSkipQ4, onReminderDayChange, onReminderDayBlur }) {
  return (
    <section aria-labelledby="set" className="bg-white border border-gray-200 rounded-xl p-5 mt-6 flex flex-col gap-3">
      <h2 id="set" className="text-lg font-semibold m-0">Settings</h2>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {settings === null && !error && <p className="text-gray-500">Loading…</p>}
      {settings && (
        <>
          <label className="flex gap-2.5 items-start text-[15px]">
            <input type="checkbox" checked={settings.skip_q4_review} onChange={e => onToggleSkipQ4(e.target.checked)} className="w-5 h-5 mt-0.5" />
            <span>Skip the Q4 quarterly review. The annual review covers it.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold max-w-[260px]">
            Monthly check-in reminder goes out on day
            <input type="number" min={1} max={28} value={settings.reminder_day_of_month}
              onChange={e => onReminderDayChange(e.target.value)} onBlur={e => onReminderDayBlur(e.target.value)}
              className="w-24 border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
          </label>
        </>
      )}
    </section>
  )
}

function CycleHistorySection({ history, error }) {
  return (
    <section aria-labelledby="cyc" className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
      <h2 id="cyc" className="text-lg font-semibold m-0 mb-1">Review cycles</h2>
      <p className="text-sm text-gray-600 mb-3">Every cycle opened so far, newest first.</p>
      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}
      {history === null && !error && <p className="text-gray-500">Loading…</p>}
      {history && history.length === 0 && <Todo>No cycles opened yet.</Todo>}
      {history && history.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[15px]">
            <thead>
              <tr className="text-left bg-gray-50">
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Cycle</th>
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Opened</th>
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Reviews</th>
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Signed off</th>
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map(c => {
                const pct = c.total ? Math.round((c.locked / c.total) * 100) : 0
                const complete = c.total > 0 && c.locked === c.total
                return (
                  <tr key={`${c.kind}-${c.period_year}-${c.period_quarter ?? 'a'}`}>
                    <th scope="row" className="px-3 py-2 text-left font-semibold border-b border-gray-100">{cycleLabel(c)}</th>
                    <td className="px-3 py-2 text-gray-600 border-b border-gray-100 whitespace-nowrap">{new Date(c.opened_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2 border-b border-gray-100">{c.total}</td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <div role="progressbar" aria-label="Signed off" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                          className="w-[90px] h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-green-700" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm">{c.locked} of {c.total}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <span className={`text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap ${complete ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                        {complete ? 'Complete' : 'In progress'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ParticipantsSection({ participants, error, onAdd, onUpdate, onRemove }) {
  const counts = (participants || []).reduce((acc, p) => {
    acc.worker[p.worker_type] = (acc.worker[p.worker_type] || 0) + 1
    acc.hours[p.hours] = (acc.hours[p.hours] || 0) + 1
    return acc
  }, { worker: {}, hours: {} })

  return (
    <section aria-labelledby="part" className="bg-white border border-gray-200 rounded-xl p-5 mt-6">
      <h2 id="part" className="text-lg font-semibold m-0 mb-1">Participants</h2>
      <p className="text-sm text-gray-600 mb-1">
        Only people listed here get reviews. Their hours decide which reviews they must have. Their worker type decides which questions they are asked.
      </p>
      {participants && (
        <p className="text-sm text-gray-600 mb-3">
          {participants.length} people: {counts.worker.paid || 0} paid, {counts.worker.seconded || 0} seconded, {counts.worker.volunteer || 0} volunteers.{' '}
          {counts.hours.full_time || 0} full-time, {counts.hours.part_time || 0} part-time.
        </p>
      )}

      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}

      <AddParticipantForm onAdd={onAdd} />

      {participants === null && !error && <p className="text-gray-500">Loading…</p>}
      {participants && participants.length === 0 && <Todo>No participants yet. Add someone above.</Todo>}

      {participants && participants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[15px]">
            <thead>
              <tr className="text-left bg-gray-50">
                <th scope="col" className="px-3 py-2 text-xs text-gray-600 font-semibold border-b border-gray-200">Person</th>
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
                    {p.display_name && <div className="text-xs font-normal text-gray-500">{p.email}</div>}
                  </th>
                  <td className="px-3 py-1.5 border-b border-gray-100">
                    <label className="sr-only" htmlFor={`w-${p.email}`}>Worker type for {p.display_name || p.email}</label>
                    <select id={`w-${p.email}`} value={p.worker_type} onChange={e => onUpdate(p.email, { worker_type: e.target.value })}
                      className="border border-gray-400 rounded-lg px-3 py-1.5 min-h-[44px] bg-white font-normal">
                      {WORKER_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 border-b border-gray-100">
                    <label className="sr-only" htmlFor={`h-${p.email}`}>Hours for {p.display_name || p.email}</label>
                    <select id={`h-${p.email}`} value={p.hours} onChange={e => onUpdate(p.email, { hours: e.target.value })}
                      className="border border-gray-400 rounded-lg px-3 py-1.5 min-h-[44px] bg-white font-normal">
                      {HOURS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 border-b border-gray-100 text-right">
                    <button type="button" onClick={() => onRemove(p.email)}
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

function QuestionCard({ q, index, count, editing, onToggleEdit, onMove, onRemove, onPatch, onToggleWorkerType }) {
  const typeLabel = TYPES.find(([k]) => k === q.type)?.[1] ?? q.type
  const restricted = q.worker_types.length < ALL_WORKER_TYPES.length
  const audienceLabel = 'Asked of: ' + q.worker_types.map(k => WORKER_TYPES.find(([wk]) => wk === k)[1]).join(', ')

  return (
    <div className={`border rounded-xl p-3.5 flex flex-col gap-3 ${editing ? 'border-brand' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-0.5">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move question ${index + 1} up`}
            className="w-8 h-5 flex items-center justify-center text-gray-600 disabled:opacity-30">▲</button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move question ${index + 1} down`}
            className="w-8 h-5 flex items-center justify-center text-gray-600 disabled:opacity-30">▼</button>
        </div>
        <span className="font-bold text-gray-600 w-5">{index + 1}</span>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[15px] font-semibold">
            {q.prompt || <span className="italic text-gray-500">New question (no text yet)</span>}
            {q.required && <span aria-hidden="true" className="text-red-700 font-bold"> *</span>}
          </div>
          <div className="mt-1 flex gap-1.5 flex-wrap">
            <span className="bg-gray-200 text-gray-700 text-xs font-semibold rounded-full px-2 py-0.5">
              {q.type === 'select' ? `Select: ${optionLines(q.optionsText).slice(0, 3).join(', ') || 'no choices yet'}` : typeLabel}
            </span>
            {restricted && (
              <span className="bg-purple-100 text-purple-800 text-xs font-semibold rounded-full px-2 py-0.5">{audienceLabel}</span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 items-center flex-wrap">
          <button type="button" onClick={onToggleEdit}
            className="bg-white text-brand border border-brand rounded-lg px-3.5 py-2 text-sm font-semibold min-h-[44px]">
            {editing ? 'Close' : 'Edit'}
          </button>
          <button type="button" onClick={onRemove}
            className="bg-white text-red-800 border border-red-800 rounded-lg px-3.5 py-2 text-sm font-semibold min-h-[44px]">
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div className="border-t border-gray-200 pt-3.5 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Question
            <input type="text" value={q.prompt} onChange={e => onPatch({ prompt: e.target.value })} placeholder="Type the question"
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
          </label>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex-1 min-w-[180px] flex flex-col gap-1 text-sm font-semibold">
              Answer type
              <select value={q.type} onChange={e => onPatch({ type: e.target.value })}
                className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
                {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="flex gap-2 items-center text-[15px] min-h-[44px]">
              <input type="checkbox" checked={q.required} onChange={e => onPatch({ required: e.target.checked })} className="w-5 h-5" />
              <span>Required <span aria-hidden="true" className="text-red-700 font-bold">*</span></span>
            </label>
          </div>
          <fieldset className="border-0 m-0 p-0 flex flex-col gap-0.5">
            <legend className="text-sm font-semibold p-0 pb-1">Who is asked this question</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {WORKER_TYPES.map(([k, label]) => (
                <label key={k} className="flex gap-2 items-center text-[15px] min-h-[44px]">
                  <input type="checkbox" checked={q.worker_types.includes(k)} onChange={() => onToggleWorkerType(k)} className="w-5 h-5" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <span className="text-xs text-gray-600">People of an unchecked type never see this question. At least one type stays checked.</span>
          </fieldset>
          {q.type === 'select' && (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Choices <span className="font-normal text-gray-600">(one per line)</span>
              <textarea rows={4} value={q.optionsText} onChange={e => onPatch({ optionsText: e.target.value })}
                className="border border-gray-400 rounded-lg p-3 font-normal resize-y" />
              <span className="text-xs font-normal text-gray-600">Your manager answers with the same choices.</span>
            </label>
          )}
          <div>
            <button type="button" onClick={onToggleEdit}
              className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
