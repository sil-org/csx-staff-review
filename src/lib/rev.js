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

export async function createGoal(ownerEmail, { title, fiscalYear, description }) {
  const { data, error } = await supabase.from('rev_goals').insert({
    owner_email: ownerEmail.toLowerCase(),
    fiscal_year: fiscalYear,
    title,
    description: description || null,
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

// All reviews for one person, RLS-filtered the same way as listReviewIds() (rev_can_read_review):
// the left nav on a person's review page, so it naturally shows only what the viewer may read.
export async function listPersonReviews(email) {
  const { data, error } = await supabase
    .from('rev_reviews').select('id, kind, period_year, period_quarter, status')
    .eq('employee_email', email.toLowerCase())
    .order('period_year', { ascending: false }).order('period_quarter', { ascending: false, nullsFirst: false })
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
    .from('profiles').select('primary_email, display_name, manager_email, employee_type').in('primary_email', emails)
  if (error) throw error
  return data
}

export const submitReview = (reviewId) => rpc('rev_submit_review', { p_review_id: reviewId })
export const sendForSignoff = (reviewId) => rpc('rev_send_for_signoff', { p_review_id: reviewId })
export const signReview = (reviewId, agree, note) => rpc('rev_sign_review', { p_review_id: reviewId, p_agreed: agree, p_note: note })

export const teamStatus = () => rpc('rev_team_status')
export const teamRoster = () => rpc('rev_team_roster')
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

// Departments: a tree with one head each. Only super admins can write here —
// enforced by RLS on rev_departments and the rev_guard_participant_dept trigger
// on rev_participants.department_id, not just by hiding the page.
export async function listDepartments() {
  const { data, error } = await supabase
    .from('rev_departments').select('id, name, parent_id, head_email, source').order('name')
  if (error) throw error
  return data
}

export async function createDepartment(name, parentId) {
  const { data, error } = await supabase.from('rev_departments')
    .insert({ name: name.trim(), parent_id: parentId || null, source: 'manual' })
    .select().single()
  if (error) throw error
  return data
}

export async function updateDepartment(id, { name, parentId, headEmail } = {}) {
  const patch = {}
  if (name !== undefined) patch.name = name.trim()
  if (parentId !== undefined) patch.parent_id = parentId || null
  if (headEmail !== undefined) patch.head_email = headEmail ? headEmail.toLowerCase() : null
  const { error } = await supabase.from('rev_departments').update(patch).eq('id', id)
  if (error) throw error
}

export async function assignParticipantDepartment(email, departmentId) {
  const { error } = await supabase.from('rev_participants')
    .update({ department_id: departmentId || null }).eq('email', email.toLowerCase())
  if (error) throw error
}

// Questions and templates: admin-only writes are enforced by RLS on the tables
// themselves (rev_templates/rev_questions "admin write" policies), so these go
// straight to the tables rather than through an RPC.
export async function activeTemplate(kind) {
  const { data, error } = await supabase
    .from('rev_templates').select('*').eq('kind', kind).eq('is_active', true).maybeSingle()
  if (error) throw error
  return data
}

export async function createTemplate(kind, name, createdBy) {
  const { data, error } = await supabase.from('rev_templates')
    .insert({ kind, name, is_active: true, created_by: createdBy.toLowerCase() })
    .select().single()
  if (error) throw error
  return data
}

export async function listQuestions(templateId) {
  const { data, error } = await supabase
    .from('rev_questions').select('*').eq('template_id', templateId).order('position')
  if (error) throw error
  return data
}

// Replaces the whole question list for a template in one request: removedIds are
// deleted, then every remaining question is upserted with its position recomputed
// from array order. rev_questions_position_uq is deferred to the end of the
// transaction, so positions can be reshuffled without a temporary collision.
export async function saveQuestions(templateId, questions, removedIds) {
  if (removedIds.length > 0) {
    const { error } = await supabase.from('rev_questions').delete().in('id', removedIds)
    if (error) throw error
  }
  if (questions.length > 0) {
    const rows = questions.map((q, i) => ({
      id: q.id,
      template_id: templateId,
      position: i + 1,
      prompt: q.prompt.trim(),
      type: q.type,
      required: q.required,
      options: q.type === 'select' ? q.options : null,
      worker_types: q.worker_types,
    }))
    const { error } = await supabase.from('rev_questions').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }
}

// Cycles: opening a cycle (whole organization, no email) is admin-only and
// separate from a department head's rev_launch_cycle (which also sends email).
export const cyclePreview = (kind, year, quarter = null) =>
  rpc('rev_cycle_preview', { p_kind: kind, p_year: year, p_quarter: quarter })
export const openCycle = (kind, year, quarter = null) =>
  rpc('rev_open_cycle', { p_kind: kind, p_year: year, p_quarter: quarter })
export const cycleHistory = () => rpc('rev_cycle_history')

export async function listRequiredReviews() {
  const { data, error } = await supabase.from('rev_required_reviews').select('*')
  if (error) throw error
  return data
}

export async function setRequiredReview(hours, review, required) {
  const { error } = await supabase.from('rev_required_reviews')
    .upsert({ hours, review, required }, { onConflict: 'hours,review' })
  if (error) throw error
}

export async function getSettings() {
  const { data, error } = await supabase.from('rev_settings').select('*').eq('id', 1).single()
  if (error) throw error
  return data
}

export async function updateSettings(fields) {
  const { error } = await supabase.from('rev_settings').update(fields).eq('id', 1)
  if (error) throw error
}

// Participants: who gets a review at all. No FK to profiles (someone can be added
// before their directory profile exists), so pair with listProfiles for display names.
export async function listParticipants() {
  const { data, error } = await supabase
    .from('rev_participants').select('*').eq('active', true).order('email')
  if (error) throw error
  return data
}

// Autocomplete source for "add by email". Strip characters that would break the
// PostgREST or-filter syntax rather than the usual SQL-injection concern (ilike
// patterns are parameterized regardless).
export async function searchProfiles(query, limit = 8) {
  const q = query.trim().replace(/[,()]/g, '')
  if (q.length < 2) return []
  const { data, error } = await supabase
    .from('profiles').select('primary_email, display_name, manager_email, employee_type')
    .or(`display_name.ilike.%${q}%,primary_email.ilike.%${q}%`)
    .limit(limit)
  if (error) throw error
  return data
}

export async function findProfile(email) {
  const { data, error } = await supabase
    .from('profiles').select('primary_email, display_name, manager_email, employee_type')
    .eq('primary_email', email.toLowerCase()).maybeSingle()
  if (error) throw error
  return data
}

// Upsert so re-adding someone who was previously removed (active = false) just
// reactivates them instead of erroring on the email primary key. Worker type isn't
// set here -- it's derived live from profiles.employee_type (rev_worker_type()).
export async function addParticipant(email, { hours }, addedBy) {
  const { data, error } = await supabase.from('rev_participants')
    .upsert({ email: email.toLowerCase(), hours, active: true, added_by: addedBy.toLowerCase() }, { onConflict: 'email' })
    .select().single()
  if (error) throw error
  return data
}

export async function updateParticipant(email, { hours } = {}) {
  const patch = {}
  if (hours) patch.hours = hours
  const { error } = await supabase.from('rev_participants').update(patch).eq('email', email.toLowerCase())
  if (error) throw error
}

// Participants are deactivated, not deleted: rev_required_reviews/rev_reviews logic
// and history should still make sense if someone is re-added later.
export async function removeParticipant(email) {
  const { error } = await supabase.from('rev_participants').update({ active: false }).eq('email', email.toLowerCase())
  if (error) throw error
}
