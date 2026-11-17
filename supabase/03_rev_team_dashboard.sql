-- ─── TEAM DASHBOARD: CHECK-IN COUNTS + NUDGE HISTORY ────────────────────────
-- Run AFTER 01_rev_schema.sql and 02_rev_departments.sql. Re-runnable.
-- If you ever re-run 01 on its own, re-run 02 and then this file afterwards.
--
-- The "My team" dashboard (src/pages/Team.jsx) needs two things no existing
-- RPC exposes to a non-admin manager:
--   * whether someone was already reminded (rev_reminder_log is admin-read-only)
--   * goal check-in counts for anyone who isn't a DIRECT report (rev_checkins
--     RLS is direct-manager-only)
-- Both RPCs below return counts/timestamps only -- never a goal's title, note,
-- or a review's content -- scoped to the caller's own reporting tree
-- (get_report_emails(), same as rev_team_status already uses), or everyone
-- for admins.

create or replace function rev_team_checkin_status(p_period_month date default date_trunc('month', now())::date)
returns table (employee_email text, active_goals int, checked_in int)
language sql stable security definer set search_path = public as $$
  select pt.email,
         count(*) filter (where g.status = 'active')::int,
         count(*) filter (where g.status = 'active' and c.id is not null)::int
  from rev_participants pt
  left join rev_goals g on g.owner_email = pt.email and g.status = 'active'
  left join rev_checkins c on c.goal_id = g.id and c.period_month = date_trunc('month', p_period_month)::date
  where pt.active
    and (rev_is_admin() or pt.email in (select get_report_emails()))
  group by pt.email
$$;

create or replace function rev_team_last_nudge()
returns table (employee_email text, last_nudged_at timestamptz)
language sql stable security definer set search_path = public as $$
  select recipient_email, max(created_at)
  from rev_reminder_log
  where kind = 'nudge'
    and (rev_is_admin() or recipient_email in (select get_report_emails()))
  group by recipient_email
$$;

revoke execute on function
  rev_team_checkin_status(date), rev_team_last_nudge()
from public, anon;

grant execute on function
  rev_team_checkin_status(date), rev_team_last_nudge()
to authenticated;
