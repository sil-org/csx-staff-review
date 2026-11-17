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

export async function listGoals({ fiscalYear, status } = {}) {
  let q = supabase.from('rev_goals').select('*').order('created_at', { ascending: false })
  if (fiscalYear) q = q.eq('fiscal_year', fiscalYear)
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

export const cancelGoal = (goalId, reason) => rpc('rev_cancel_goal', { p_goal_id: goalId, p_reason: reason })

export const submitReview = (reviewId) => rpc('rev_submit_review', { p_review_id: reviewId })
export const sendForSignoff = (reviewId) => rpc('rev_send_for_signoff', { p_review_id: reviewId })
export const signReview = (reviewId, agree, note) => rpc('rev_sign_review', { p_review_id: reviewId, p_agreed: agree, p_note: note })

export const teamStatus = () => rpc('rev_team_status')

// Launching: preview first (counts + who already launched), then launch with the edited email.
export const launchPreview = (deptId, kind, year, quarter = null) =>
  rpc('rev_launch_preview', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
export const launchCycle = (deptId, kind, year, quarter, subject, bodyHtml) =>
  rpc('rev_launch_cycle', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter, p_subject: subject, p_body_html: bodyHtml })

export const departmentReport = (deptId, kind, year, quarter = null) =>
  rpc('rev_department_report', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
export const departmentStatus = (deptId, kind, year, quarter = null) =>
  rpc('rev_department_status', { p_dept: deptId, p_kind: kind, p_year: year, p_quarter: quarter })
