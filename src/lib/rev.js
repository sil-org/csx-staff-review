import { supabase } from './supabase'

// Thin wrappers over the rev_* RPCs/tables (supabase/01_rev_schema.sql, 02_rev_departments.sql).
// Business rules live in Postgres; these just call it.

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

export const isAdmin = () => rpc('rev_is_admin')
export const isSuperAdmin = () => rpc('rev_is_super_admin')

export async function myHeadedDepartments(email) {
  const { data, error } = await supabase
    .from('rev_departments').select('id, name, parent_id, head_email')
    .eq('head_email', email.toLowerCase())
  if (error) throw error
  return data
}

export async function listGoals({ fiscalYear, status, ownerEmail } = {}) {
  let q = supabase.from('rev_goals').select('*').order('created_at', { ascending: false })
  if (fiscalYear) q = q.eq('fiscal_year', fiscalYear)
  if (status && status !== 'all') q = q.eq('status', status)
  if (ownerEmail) q = q.eq('owner_email', ownerEmail.toLowerCase())
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function listCheckins(goalId) {
  const { data, error } = await supabase
    .from('rev_checkins').select('*').eq('goal_id', goalId).order('period_month')
  if (error) throw error
  return data
}

export async function createGoal(ownerEmail, { title, fiscalYear, successMeasure, description, targetValue, unit }) {
  const { data, error } = await supabase.from('rev_goals').insert({
    owner_email: ownerEmail.toLowerCase(),
    fiscal_year: fiscalYear,
    title,
    success_measure: successMeasure || null,
    description: description || null,
    target_value: targetValue || null,
    unit: unit || null,
  }).select().single()
  if (error) throw error
  return data
}

export async function upsertCheckin(goalId, ownerEmail, periodMonth, { progressPct, status, note }) {
  const { error } = await supabase.from('rev_checkins').upsert({
    goal_id: goalId,
    owner_email: ownerEmail.toLowerCase(),
    period_month: periodMonth,
    progress_pct: progressPct,
    status,
    note: note || null,
  }, { onConflict: 'goal_id,period_month' })
  if (error) throw error
}

export const cancelGoal = (goalId, reason) => rpc('rev_cancel_goal', { p_goal_id: goalId, p_reason: reason })

// RLS-filtered: only returns reviews where the caller is the employee, the
// snapshot manager (once submitted), or an admin. Used to attach review ids
// to rev_team_status's status-only rows for the ones the caller can open.
export async function listReviewIds() {
  const { data, error } = await supabase
    .from('rev_reviews').select('id, employee_email, kind, period_year, period_quarter, status')
  if (error) throw error
  return data
}

export async function getReview(reviewId) {
  const { data, error } = await supabase.from('rev_reviews').select('*').eq('id', reviewId).single()
  if (error) throw error
  return data
}

export async function listAnswers(reviewId) {
  const { data, error } = await supabase.from('rev_answers').select('*').eq('review_id', reviewId)
  if (error) throw error
  return data
}

export async function listComments(reviewId) {
  const { data, error } = await supabase.from('rev_comments').select('*').eq('review_id', reviewId)
  if (error) throw error
  return data
}

export async function upsertComment(reviewId, questionKey, body, authorEmail) {
  const { error } = await supabase.from('rev_comments')
    .upsert({ review_id: reviewId, question_key: questionKey, body, author_email: authorEmail.toLowerCase() },
            { onConflict: 'review_id,question_key' })
  if (error) throw error
}

export async function listProfiles(emails) {
  const { data, error } = await supabase
    .from('profiles').select('primary_email, display_name').in('primary_email', emails)
  if (error) throw error
  return data
}

export const submitReview = (reviewId) => rpc('rev_submit_review', { p_review_id: reviewId })
export const sendForSignoff = (reviewId) => rpc('rev_send_for_signoff', { p_review_id: reviewId })
export const signReview = (reviewId, agree, note) => rpc('rev_sign_review', { p_review_id: reviewId, p_agreed: agree, p_note: note })

export const teamStatus = () => rpc('rev_team_status')
export const requestNudge = (email) => rpc('rev_request_nudge', { p_employee_email: email })
export const teamCheckinStatus = (periodMonth) => rpc('rev_team_checkin_status', { p_period_month: periodMonth })
export const teamLastNudge = () => rpc('rev_team_last_nudge')

// Launching: preview first (counts + who already launched), then launch with the edited email.
export const launchPreview = (deptId, kind, year, quarter = null) =>
  rpc('rev_launch_preview', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
export const launchCycle = (deptId, kind, year, quarter, subject, bodyHtml) =>
  rpc('rev_launch_cycle', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter, p_subject: subject, p_body_html: bodyHtml })

export const departmentReport = (deptId, kind, year, quarter = null) =>
  rpc('rev_department_report', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
export const departmentStatus = (deptId, kind, year, quarter = null) =>
  rpc('rev_department_status', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
