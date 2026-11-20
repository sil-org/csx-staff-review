import { useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import Page, { Todo } from '../../components/Page'
import { useAuth } from '../../context/AuthContext'
import { useRev } from '../../context/RevContext'
import {
  activeTemplate, createTemplate, listQuestions, saveQuestions,
  cyclePreview, openCycle, cycleHistory, listRequiredReviews, setRequiredReview, getSettings, updateSettings,
} from '../../lib/rev'
import { fiscalYearOf, fiscalQuarterOf } from '../../lib/fiscal'

const TYPES = [['paragraph', 'Paragraph'], ['short_text', 'Short text'], ['select', 'Select (dropdown)']]
const WORKER_TYPES = [['paid', 'Paid'], ['seconded', 'Seconded'], ['volunteer', 'Volunteers']]
const ALL_WORKER_TYPES = WORKER_TYPES.map(([k]) => k)
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
  const [saveStatus, setSaveStatus] = useState({ state: 'idle' })
  const [error, setError] = useState('')
  const skipNextAutosave = useRef(true)

  function load() {
    setError('')
    setQuestions(null)
    setSaveStatus({ state: 'idle' })
    activeTemplate(kind)
      .then(t => t || createTemplate(kind, kind === 'quarterly' ? 'Quarterly review questions' : 'Annual review questions', profile.primary_email))
      .then(async t => {
        const rows = await listQuestions(t.id)
        setTemplateId(t.id)
        skipNextAutosave.current = true
        setQuestions(rows.map(fromRow))
        setRemovedIds([])
        setEditingId(null)
      })
      .catch(e => setError(e.message))
  }

  useEffect(() => { if (rev.ready && rev.admin) load() }, [kind, rev.ready, rev.admin])

  // Autosaves the whole question list (and any pending deletions) a moment after it last
  // changed, so typing doesn't fire a request per keystroke. Skips the save -- without
  // erroring -- while any question is incomplete; that question's own card already shows
  // why (empty prompt / no choices yet).
  useEffect(() => {
    if (!questions) return
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return }
    const timer = setTimeout(() => {
      const incomplete = questions.find(q => !q.prompt.trim())
      if (incomplete) { setSaveStatus({ state: 'blocked', message: 'Add the question text to save it.' }); return }
      const needsChoices = questions.find(q => q.type === 'select' && optionLines(q.optionsText).length === 0)
      if (needsChoices) { setSaveStatus({ state: 'blocked', message: `"${needsChoices.prompt}" needs at least one choice to save.` }); return }

      setSaveStatus({ state: 'saving' })
      const payload = questions.map(q => ({ ...q, options: optionLines(q.optionsText) }))
      saveQuestions(templateId, payload, removedIds)
        .then(() => { setRemovedIds([]); setSaveStatus({ state: 'saved' }) })
        .catch(e => setSaveStatus({ state: 'error', message: e.message }))
    }, 800)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, removedIds])

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
  }

  function move(from, to) {
    if (from < 0 || to < 0 || to >= questions.length || from === to) return
    setQuestions(qs => {
      const next = qs.slice()
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  // Drag-to-reorder: the handle captures the pointer on pointerdown, so moves keep
  // arriving even once the finger/cursor leaves it. pointermove walks the element
  // under the pointer back to its question card (data-qid) to find what it's over.
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  function handleDragStart(e, id) {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported */ }
    setDragId(id)
    setOverId(null)
  }
  function handleDragMove(e, id) {
    if (dragId !== id) return
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const row = el?.closest?.('[data-qid]')
    const target = row ? row.getAttribute('data-qid') : null
    if (target !== overId) setOverId(target)
  }
  function handleDragEnd(e, id) {
    if (dragId !== id) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* unsupported */ }
    const from = questions.findIndex(q => q.id === id)
    const to = questions.findIndex(q => q.id === overId)
    setDragId(null)
    setOverId(null)
    if (to >= 0) move(from, to)
  }
  function handleDragCancel() {
    setDragId(null)
    setOverId(null)
  }
  function handleHandleKeyDown(e, index) {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(index, index - 1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(index, index + 1) }
  }

  function addQuestion() {
    const q = newQuestion()
    setQuestions(qs => (qs || []).concat([q]))
    setEditingId(q.id)
  }

  function removeQuestion(id) {
    setQuestions(qs => qs.filter(q => q.id !== id))
    setRemovedIds(ids => ids.concat([id]))
    if (editingId === id) setEditingId(null)
  }

  function toggleWorkerType(q, key) {
    const has = q.worker_types.includes(key)
    const next = ALL_WORKER_TYPES.filter(k => (k === key ? !has : q.worker_types.includes(k)))
    if (next.length === 0) return
    patch(q.id, { worker_types: next })
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
          Drag a question by its handle to reorder — it works with a finger or a mouse, or press the up/down
          arrow keys while the handle is focused. Changes apply to reviews opened after you save. Reviews
          already open keep the questions they started with.
        </p>

        {questions === null && !error && <p className="text-gray-500">Loading…</p>}
        {questions && questions.length === 0 && <Todo>No questions yet. Add one below.</Todo>}

        <div className="flex flex-col gap-3">
          {(questions || []).map((q, i) => {
            const dragIndex = questions.findIndex(x => x.id === dragId)
            const isOver = !!dragId && dragId !== q.id && overId === q.id
            return (
            <QuestionCard key={q.id} q={q} index={i}
              editing={editingId === q.id}
              dragging={dragId === q.id}
              overIndicator={isOver ? (dragIndex < i ? 'below' : 'above') : null}
              onToggleEdit={() => setEditingId(editingId === q.id ? null : q.id)}
              onHandlePointerDown={e => handleDragStart(e, q.id)}
              onHandlePointerMove={e => handleDragMove(e, q.id)}
              onHandlePointerUp={e => handleDragEnd(e, q.id)}
              onHandlePointerCancel={handleDragCancel}
              onHandleKeyDown={e => handleHandleKeyDown(e, i)}
              onRemove={() => removeQuestion(q.id)}
              onPatch={fields => patch(q.id, fields)}
              onToggleWorkerType={key => toggleWorkerType(q, key)}
            />
            )
          })}
        </div>

        <div className="flex flex-wrap gap-3 items-center mt-4">
          <button type="button" onClick={addQuestion}
            className="bg-white text-brand border border-brand rounded-lg px-4 min-h-[44px] text-sm font-semibold">
            Add a question
          </button>
          <SaveStatus status={saveStatus} />
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

function SaveStatus({ status }) {
  if (status.state === 'saving') return <span role="status" className="text-sm text-gray-600">Saving…</span>
  if (status.state === 'saved') return <span role="status" className="text-sm text-green-800">Saved. New reviews will use these questions.</span>
  if (status.state === 'blocked') return <span role="status" className="text-sm text-gray-600">Not saved yet — {status.message}</span>
  if (status.state === 'error') return <span role="alert" className="text-sm text-red-700">Couldn&rsquo;t save: {status.message}</span>
  return null
}

function QuestionCard({
  q, index, editing, dragging, overIndicator, onToggleEdit,
  onHandlePointerDown, onHandlePointerMove, onHandlePointerUp, onHandlePointerCancel, onHandleKeyDown,
  onRemove, onPatch, onToggleWorkerType,
}) {
  const typeLabel = TYPES.find(([k]) => k === q.type)?.[1] ?? q.type
  const restricted = q.worker_types.length < ALL_WORKER_TYPES.length
  const audienceLabel = 'Asked of: ' + q.worker_types.map(k => WORKER_TYPES.find(([wk]) => wk === k)[1]).join(', ')
  const boxShadow = overIndicator === 'below' ? '0 3px 0 0 #005CB9' : overIndicator === 'above' ? '0 -3px 0 0 #005CB9' : 'none'

  return (
    <div data-qid={q.id} style={{ opacity: dragging ? 0.45 : 1, boxShadow }}
      className={`border rounded-xl p-3.5 flex flex-col gap-3 ${overIndicator || editing ? 'border-brand' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button"
          aria-label={`Reorder question ${index + 1}. Drag, or press the up and down arrow keys.`}
          title="Drag to reorder"
          onPointerDown={onHandlePointerDown} onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp} onPointerCancel={onHandlePointerCancel} onKeyDown={onHandleKeyDown}
          className="w-11 h-11 flex-shrink-0 flex items-center justify-center text-gray-600 bg-gray-100 border border-gray-300 rounded-lg cursor-grab touch-none select-none">
          <GripVertical size={20} />
        </button>
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
            <div className="flex flex-col gap-0.5">
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
