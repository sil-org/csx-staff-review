import { useEffect, useState } from 'react'
import Page, { Todo } from '../components/Page'
import { useAuth } from '../context/AuthContext'
import { listGoals, listCheckins, createGoal, upsertCheckin, cancelGoal } from '../lib/rev'
import { fiscalYearOf, fiscalYearLabel, currentPeriodMonth } from '../lib/fiscal'

const STATUSES = [['active', 'Active'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']]
const CHECKIN_STATUSES = [['on_track', 'On track'], ['at_risk', 'At risk'], ['off_track', 'Off track'], ['done', 'Done']]
const CHECKIN_STATUS_LABELS = Object.fromEntries(CHECKIN_STATUSES)

export default function MyGoals() {
  const { profile } = useAuth()
  const current = fiscalYearOf()
  const [fy, setFy] = useState(current)
  const [status, setStatus] = useState('active')
  const [goals, setGoals] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [openGoalId, setOpenGoalId] = useState(null)
  const [cancelId, setCancelId] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    setGoals(null)
    listGoals({ fiscalYear: fy === 'all' ? null : fy, status })
      .then(async list => {
        const withCheckins = await Promise.all(list.map(async g => {
          if (g.status !== 'active') return g
          const checkins = await listCheckins(g.id).catch(() => [])
          return { ...g, latest: checkins[checkins.length - 1] }
        }))
        setGoals(withCheckins)
      })
      .catch(e => setError(e.message))
  }

  useEffect(load, [fy, status])

  async function handleAddGoal(fields) {
    setSaving(true)
    setError('')
    try {
      await createGoal(profile.primary_email, fields)
      setAdding(false)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckin(goalId, fields) {
    setSaving(true)
    setError('')
    try {
      await upsertCheckin(goalId, profile.primary_email, currentPeriodMonth(), fields)
      setOpenGoalId(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel(goalId) {
    setSaving(true)
    setError('')
    try {
      await cancelGoal(goalId, cancelReason)
      setCancelId(null)
      setCancelReason('')
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page title="My goals" subtitle={fy === 'all' ? 'All fiscal years' : fiscalYearLabel(fy)}>
      <div className="flex flex-wrap gap-3 items-end justify-between mb-4">
        <div className="flex gap-3 items-end flex-wrap">
          <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
            Status
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
              {STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-gray-600 flex flex-col gap-1">
            Fiscal year
            <select value={fy} onChange={e => setFy(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal text-base">
              {[current, current - 1, current - 2].map(y => <option key={y} value={y}>FY{y}{y === current ? ' (current)' : ''}</option>)}
              <option value="all">All years</option>
            </select>
          </label>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold">
          Add a goal
        </button>
      </div>

      {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}

      {adding && (
        <AddGoalForm defaultFiscalYear={fy === 'all' ? current : fy} saving={saving}
          onSave={handleAddGoal} onCancel={() => setAdding(false)} />
      )}

      {goals === null && !error && <p className="text-gray-500">Loading…</p>}
      {goals && goals.length === 0 && <Todo>No goals match this filter.</Todo>}
      <ul className="space-y-3">
        {(goals || []).map(g => (
          <li key={g.id} className={`border rounded-xl p-4 ${g.status === 'cancelled' ? 'bg-gray-100 border-gray-200' : 'bg-white border-gray-200'}`}>
            <div className="flex justify-between gap-3 flex-wrap items-start">
              <div className="min-w-0">
                <div className={`font-semibold text-[17px] ${g.status === 'cancelled' ? 'text-gray-600' : ''}`}>{g.title}</div>
                <div className="text-sm text-gray-600">{fiscalYearLabel(g.fiscal_year)}</div>
                {g.description && <p className="text-sm text-gray-700 mt-1">{g.description}</p>}
              </div>
              <span className="bg-gray-100 text-gray-700 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap">{g.status}</span>
            </div>

            {g.status === 'active' && (
              <div className="flex items-center gap-3 mt-3">
                <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={g.latest?.progress_pct ?? 0}
                  className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${g.latest?.progress_pct ?? 0}%` }} />
                </div>
                <span className="text-sm font-semibold w-11 text-right">{g.latest?.progress_pct ?? 0}%</span>
                {g.latest && (
                  <span className="bg-gray-100 text-gray-700 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap">
                    {CHECKIN_STATUS_LABELS[g.latest.status] || g.latest.status}
                  </span>
                )}
              </div>
            )}

            {g.status === 'cancelled' && (
              <div className="border-t border-gray-200 mt-3 pt-2 text-sm text-gray-600">
                <span className="font-semibold">Cancelled {new Date(g.cancelled_at).toLocaleDateString()}.</span> {g.cancel_reason}
              </div>
            )}

            {g.status === 'active' && (
              <div className="flex justify-between items-center gap-3 flex-wrap mt-3 text-sm text-gray-600">
                <span>{g.latest ? `Last check-in ${new Date(g.latest.period_month).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'No check-ins yet'}</span>
                <span className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => { setCancelId(cancelId === g.id ? null : g.id); setCancelReason(''); setOpenGoalId(null) }}
                    className="bg-white text-red-800 border border-red-800 rounded-lg px-3.5 py-2 text-sm font-semibold min-h-[44px]">
                    Cancel goal
                  </button>
                  <button type="button" onClick={() => { setOpenGoalId(openGoalId === g.id ? null : g.id); setCancelId(null) }}
                    className="bg-white text-brand border border-brand rounded-lg px-3.5 py-2 text-sm font-semibold min-h-[44px]">
                    {openGoalId === g.id ? 'Close' : g.latest ? 'Update' : 'Check in'}
                  </button>
                </span>
              </div>
            )}

            {openGoalId === g.id && (
              <CheckinForm goal={g} saving={saving} onSave={fields => handleCheckin(g.id, fields)} onCancel={() => setOpenGoalId(null)} />
            )}

            {cancelId === g.id && (
              <CancelGoalForm reason={cancelReason} setReason={setCancelReason} saving={saving}
                onConfirm={() => handleCancel(g.id)} onKeep={() => { setCancelId(null); setCancelReason('') }} />
            )}
          </li>
        ))}
      </ul>
    </Page>
  )
}

function AddGoalForm({ defaultFiscalYear, saving, onSave, onCancel }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear)

  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ title, description, fiscalYear }) }}
      className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-col gap-3">
      <div className="font-semibold text-base">Add a goal</div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Title
        <input required value={title} onChange={e => setTitle(e.target.value)}
          className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Description <span className="font-normal text-gray-500">(optional)</span>
        <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
          className="border border-gray-400 rounded-lg p-3 font-normal resize-y" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold max-w-[200px]">
        Fiscal year
        <select value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}
          className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
          {[defaultFiscalYear, defaultFiscalYear - 1, defaultFiscalYear - 2].map(y => <option key={y} value={y}>FY{y}</option>)}
        </select>
      </label>
      <div className="flex gap-2 flex-wrap">
        <button type="submit" disabled={saving || !title.trim()}
          className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60">
          {saving ? 'Saving…' : 'Save goal'}
        </button>
        <button type="button" onClick={onCancel}
          className="bg-white text-gray-700 border border-gray-400 rounded-lg px-4 min-h-[44px] text-sm font-semibold">
          Cancel
        </button>
      </div>
    </form>
  )
}

function CheckinForm({ goal, saving, onSave, onCancel }) {
  const [progressPct, setProgressPct] = useState(goal.latest?.progress_pct ?? 50)
  const [statusValue, setStatusValue] = useState(goal.latest?.status ?? 'on_track')
  const [note, setNote] = useState(goal.latest?.note ?? '')

  return (
    <form onSubmit={e => { e.preventDefault(); onSave({ progressPct: Number(progressPct), status: statusValue, note }) }}
      className="border-t border-gray-200 mt-3 pt-4 flex flex-col gap-3">
      <div className="font-semibold text-base">This month&rsquo;s check-in</div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-[140px]">
          Progress (%)
          <input type="number" min={0} max={100} value={progressPct} onChange={e => setProgressPct(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold flex-1 min-w-[180px]">
          Status
          <select value={statusValue} onChange={e => setStatusValue(e.target.value)}
            className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white font-normal">
            {CHECKIN_STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        What happened this month?
        <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
          className="border border-gray-400 rounded-lg p-3 font-normal resize-y" />
      </label>
      <div className="flex gap-2 flex-wrap items-center">
        <button type="submit" disabled={saving}
          className="bg-brand text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60">
          {saving ? 'Saving…' : 'Save check-in'}
        </button>
        <button type="button" onClick={onCancel}
          className="bg-white text-gray-700 border border-gray-400 rounded-lg px-4 min-h-[44px] text-sm font-semibold">
          Cancel
        </button>
        <span className="text-xs text-gray-600">Your manager can see this check-in.</span>
      </div>
    </form>
  )
}

function CancelGoalForm({ reason, setReason, saving, onConfirm, onKeep }) {
  return (
    <div className="border-t border-gray-200 mt-3 pt-4 flex flex-col gap-3">
      <div className="font-semibold text-base">Cancel this goal?</div>
      <p className="text-sm text-gray-600">
        The goal and its check-ins stay on record and your manager can still see them. You can&rsquo;t add
        check-ins or reopen it afterward.
      </p>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Why is it being cancelled? <span className="font-normal text-gray-600">(optional)</span>
        <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
          className="border border-gray-400 rounded-lg p-3 font-normal resize-y" />
      </label>
      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" disabled={saving} onClick={onConfirm}
          className="bg-red-800 text-white rounded-lg px-4 min-h-[44px] text-sm font-semibold disabled:opacity-60 disabled:bg-gray-500">
          Cancel goal
        </button>
        <button type="button" onClick={onKeep}
          className="bg-white text-gray-700 border border-gray-400 rounded-lg px-4 min-h-[44px] text-sm font-semibold">
          Keep goal
        </button>
      </div>
    </div>
  )
}
