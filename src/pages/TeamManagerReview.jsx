import { useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import Page from '../components/Page'
import { useAuth } from '../context/AuthContext'
import { getReview, listAnswers, listComments, upsertComment, sendForSignoff, listGoals, listCheckins, listPersonReviews } from '../lib/rev'
import { periodLabel, statusLabel } from '../lib/reviewLabels'

export default function TeamManagerReview() {
  const { email, reviewId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [review, setReview] = useState(null)
  const [answerByKey, setAnswerByKey] = useState({})
  const [commentByKey, setCommentByKey] = useState({})
  const [goals, setGoals] = useState(null)
  const [goalsError, setGoalsError] = useState(false)
  const [personReviews, setPersonReviews] = useState(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [savingKey, setSavingKey] = useState(null)

  const displayName = location.state?.displayName || email

  useEffect(() => {
    let cancelled = false
    setReview(null)
    Promise.all([getReview(reviewId), listAnswers(reviewId), listComments(reviewId)])
      .then(([r, answers, comments]) => {
        if (cancelled) return
        setReview(r)
        setAnswerByKey(Object.fromEntries(answers.map(a => [a.question_key, a.value])))
        setCommentByKey(Object.fromEntries(comments.map(c => [c.question_key, c.body])))
      })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [reviewId])

  useEffect(() => {
    let cancelled = false
    setGoals(null)
    setGoalsError(false)
    listGoals({ ownerEmail: email, status: 'active' })
      .then(async list => {
        const withCheckins = await Promise.all(list.map(async g => {
          const checkins = await listCheckins(g.id).catch(() => [])
          const latest = checkins[checkins.length - 1]
          return { ...g, latest }
        }))
        if (!cancelled) setGoals(withCheckins)
      })
      .catch(() => { if (!cancelled) { setGoals([]); setGoalsError(true) } })
    return () => { cancelled = true }
  }, [email])

  useEffect(() => {
    let cancelled = false
    setPersonReviews(null)
    listPersonReviews(email)
      .then(rows => { if (!cancelled) setPersonReviews(rows) })
      .catch(() => { if (!cancelled) setPersonReviews([]) })
    return () => { cancelled = true }
  }, [email])

  const editable = review?.status === 'with_manager'

  async function saveComment(questionKey, body) {
    setSavingKey(questionKey)
    try {
      await upsertComment(reviewId, questionKey, body, profile.primary_email)
    } catch (e) {
      setError(e.message)
    } finally {
      setSavingKey(null)
    }
  }

  async function handleSendForSignoff() {
    setSending(true)
    setError('')
    try {
      await sendForSignoff(reviewId)
      navigate('/team')
    } catch (e) {
      setError(e.message)
      setSending(false)
    }
  }

  if (error && !review) return <Page title={displayName}><p role="alert" className="text-red-700">{error}</p></Page>
  if (!review) return <Page title={displayName}><p className="text-gray-500">Loading…</p></Page>

  return (
    <Page
      title={displayName}
      subtitle={
        <>
          <Link to="/team" className="text-sm">My team</Link> / {periodLabel(review.kind, review.period_year, review.period_quarter)} ·{' '}
          <span className="bg-blue-100 text-blue-900 text-xs font-semibold rounded-full px-2.5 py-0.5">{statusLabel(review.status)}</span>
        </>
      }
    >
      {error && <p role="alert" className="text-red-700 mb-4">{error}</p>}
      <div className="flex flex-wrap gap-6 items-start">
        <nav aria-label={`${displayName}'s reviews`} className="flex-none w-full sm:w-48 flex flex-col gap-1">
          {personReviews === null && <p className="text-sm text-gray-500">Loading…</p>}
          {personReviews?.length === 0 && <p className="text-sm text-gray-500">No reviews yet.</p>}
          {personReviews?.map(r => (
            <Link key={r.id} to={`/team/${encodeURIComponent(email)}/review/${r.id}`} state={{ displayName }}
              className={`flex flex-col gap-0.5 rounded-lg px-3 py-2 border-l-[3px] transition-colors
                ${r.id === reviewId
                  ? 'border-brand text-brand bg-brand/[0.08] font-semibold'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
              <span className="text-sm">{periodLabel(r.kind, r.period_year, r.period_quarter)}</span>
              <span className="text-xs">{statusLabel(r.status)}</span>
            </Link>
          ))}
        </nav>

        <div className="flex-[999_1_480px] min-w-0 flex flex-col gap-4">
          {review.questions.map(q => (
            <section key={q.key} className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
              <h2 className="text-base font-semibold">{q.position}. {q.prompt}</h2>
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[240px] bg-gray-100 border border-gray-200 rounded-lg p-3 text-[15px]">
                  {answerByKey[q.key]
                    ? <span className="whitespace-pre-wrap">{answerByKey[q.key]}</span>
                    : <span className="text-gray-500 italic">No answer{q.required ? '' : ' (optional question)'}</span>}
                </div>
                <div className="flex-1 min-w-[240px]">
                  <CommentInput
                    question={q}
                    value={commentByKey[q.key] || ''}
                    editable={editable}
                    saving={savingKey === q.key}
                    onChange={v => setCommentByKey(prev => ({ ...prev, [q.key]: v }))}
                    onSave={v => saveComment(q.key, v)}
                  />
                </div>
              </div>
            </section>
          ))}

          <section className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-2">
            <label htmlFor="overall" className="text-base font-semibold">
              Overall comment <span className="font-normal text-gray-600 text-sm">(optional)</span>
            </label>
            <textarea id="overall" rows={3} disabled={!editable}
              value={commentByKey._overall || ''}
              onChange={e => setCommentByKey(prev => ({ ...prev, _overall: e.target.value }))}
              onBlur={e => editable && saveComment('_overall', e.target.value)}
              className="border border-gray-400 rounded-lg p-3 text-[15px] disabled:bg-gray-100 disabled:text-gray-500" />
          </section>

          {editable && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex justify-end">
              <button type="button" onClick={handleSendForSignoff} disabled={sending}
                className="bg-brand text-white rounded-lg px-5 py-2.5 text-sm font-semibold min-h-[44px] disabled:opacity-60">
                {sending ? 'Sending…' : `Send to ${displayName} for sign-off`}
              </button>
            </div>
          )}
        </div>

        <aside aria-label={`${displayName}'s goals`} className="flex-1 min-w-[260px] max-w-[340px] bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-lg font-semibold mb-1">{displayName}&rsquo;s goals</h2>
          <p className="text-xs text-gray-600 mb-3">Latest check-ins, for context.</p>
          {goalsError && <p className="text-sm text-gray-600">Goals unavailable.</p>}
          {!goalsError && goals === null && <p className="text-sm text-gray-500">Loading…</p>}
          {!goalsError && goals?.length === 0 && <p className="text-sm text-gray-600">No active goals.</p>}
          <div className="flex flex-col gap-3">
            {goals?.map(g => (
              <div key={g.id} className="flex flex-col gap-1">
                <div className="text-[15px] font-semibold">{g.title}</div>
                {g.latest ? (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span className="bg-gray-100 rounded-full px-2 py-0.5 text-xs font-semibold">{g.latest.status}</span>
                    <span>{g.latest.progress_pct ?? '—'}% complete</span>
                  </div>
                ) : <div className="text-sm text-gray-500">No check-ins yet</div>}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </Page>
  )
}

function CommentInput({ question, value, editable, saving, onChange, onSave }) {
  const label = `Your response to question ${question.position}`
  let input
  if (question.type === 'select') {
    input = (
      <select aria-label={label} disabled={!editable} value={value}
        onChange={e => { onChange(e.target.value); onSave(e.target.value) }}
        className="border border-gray-400 rounded-lg px-3 min-h-[44px] bg-white disabled:bg-gray-100 disabled:text-gray-500 w-full">
        <option value="">Choose one</option>
        {(question.options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  } else if (question.type === 'short_text') {
    input = (
      <input aria-label={label} type="text" maxLength={255} disabled={!editable} value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => editable && onSave(e.target.value)}
        className="border border-gray-400 rounded-lg px-3 min-h-[44px] disabled:bg-gray-100 disabled:text-gray-500 w-full" />
    )
  } else {
    input = (
      <textarea aria-label={label} rows={5} disabled={!editable} value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={e => editable && onSave(e.target.value)}
        className="border border-gray-400 rounded-lg p-3 disabled:bg-gray-100 disabled:text-gray-500 w-full" />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {input}
      {saving && <span className="text-xs text-gray-500">Saving…</span>}
    </div>
  )
}
