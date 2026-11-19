-- ─── REVIEW PLATFORM — rev_ SCHEMA ──────────────────────────────────────────
-- Goals + monthly check-ins, quarterly and annual reviews, in the SHARED GTIS
-- Supabase project. Every table/function here is prefixed rev_ so it can't
-- collide with License Manager, Helpdesk or the contract repository.
--
-- Run in the Supabase SQL Editor. Re-runnable (if not exists / create or replace
-- / drop policy if exists). Do NOT re-run the template's schema.sql — the shared
-- project already has profiles, linked_accounts and the helper functions below.
--
-- DEPENDS ON (already in the shared project, from License Manager):
--   profiles(primary_email, manager_email, display_name)   -- manager_email is the hierarchy
--   current_profile_id(), current_profile_email(), require_profile_email()
--   get_report_emails()   -- direct + indirect reports of the caller
--
-- IDENTITY: everything keys on lowercased email, same as the hierarchy.
-- BOOTSTRAP the first admin by hand (SQL Editor bypasses RLS):
--   insert into rev_admins (email, added_by) values ('you@sil.org', 'bootstrap');
--
-- DESIGN NOTES
--   * Review content is only ever written through the RPCs below or the narrow
--     answer/comment policies. Status changes happen only in RPCs.
--   * A review snapshots its questions and its manager when it is created, so
--     later template edits or hierarchy imports never change a review in flight.
--   * Direct manager sees a review's answers only after it is submitted.
--     Skip-levels see status only (rev_team_status), never answers.
--   * Locked reviews are immutable: triggers block any change, even from RPCs.

-- ─── ADMINS, SETTINGS, PARTICIPANTS ──────────────────────────────────────────

create table if not exists rev_admins (
  email      text primary key check (email = lower(email)),
  added_by   text not null,
  created_at timestamptz not null default now()
);

-- Singleton row of org-wide settings.
create table if not exists rev_settings (
  id                    int primary key default 1 check (id = 1),
  skip_q4_review        boolean not null default true,   -- annual review covers Q4
  reminder_day_of_month int not null default 1 check (reminder_day_of_month between 1 and 28)
);
insert into rev_settings (id) values (1) on conflict do nothing;

-- The hierarchy has ~4,000 people; only these emails take part in reviews.
create table if not exists rev_participants (
  email       text primary key check (email = lower(email)),
  active      boolean not null default true,
  -- How the person works. Hours decide WHICH reviews are required (rev_required_reviews);
  -- worker type decides WHICH questions they are asked (rev_questions.worker_types).
  hours       text not null default 'full_time' check (hours in ('full_time', 'part_time')),
  worker_type text not null default 'paid' check (worker_type in ('paid', 'seconded', 'volunteer')),
  added_by    text not null,
  added_at    timestamptz not null default now()
);
-- Bring a database that ran an earlier draft up to date.
alter table rev_participants add column if not exists hours text not null default 'full_time';
alter table rev_participants add column if not exists worker_type text not null default 'paid';
alter table rev_participants drop constraint if exists rev_participants_hours_check;
alter table rev_participants add constraint rev_participants_hours_check check (hours in ('full_time', 'part_time'));
alter table rev_participants drop constraint if exists rev_participants_worker_type_check;
alter table rev_participants add constraint rev_participants_worker_type_check check (worker_type in ('paid', 'seconded', 'volunteer'));

-- Which reviews each kind of worker must have. One row per (hours, review); the admin flips `required`.
-- review is q1..q4 for the quarterly reviews, or annual. (Q4 is also switched off org-wide while
-- rev_settings.skip_q4_review is on.)
create table if not exists rev_required_reviews (
  hours    text not null check (hours in ('full_time', 'part_time')),
  review   text not null check (review in ('q1', 'q2', 'q3', 'q4', 'annual')),
  required boolean not null,
  primary key (hours, review)
);
-- Defaults: full-time staff get every review; part-time staff get the annual review only.
-- (on conflict do nothing: re-running this file never overwrites what an admin has chosen.)
insert into rev_required_reviews (hours, review, required) values
  ('full_time', 'q1', true), ('full_time', 'q2', true), ('full_time', 'q3', true), ('full_time', 'q4', true), ('full_time', 'annual', true),
  ('part_time', 'q1', false), ('part_time', 'q2', false), ('part_time', 'q3', false), ('part_time', 'q4', false), ('part_time', 'annual', true)
on conflict do nothing;

-- ─── TEMPLATES AND QUESTIONS (admin-managed) ─────────────────────────────────

create table if not exists rev_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('quarterly', 'annual')),
  name       text not null,
  is_active  boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one active template per kind; opening a cycle uses the active one.
create unique index if not exists rev_templates_one_active on rev_templates (kind) where is_active;

create table if not exists rev_questions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references rev_templates(id) on delete cascade,
  position    int not null,
  prompt      text not null,
  help_text   text,
  type        text not null check (type in ('short_text', 'paragraph', 'select')),
  options     jsonb,                      -- JSON array of strings, select only
  required    boolean not null default false,
  -- Who is asked this question. Default: everyone.
  worker_types text[] not null default array['paid', 'seconded', 'volunteer'],
  constraint rev_questions_worker_types check (
    cardinality(worker_types) > 0 and worker_types <@ array['paid', 'seconded', 'volunteer']
  ),
  constraint rev_questions_position_uq unique (template_id, position) deferrable initially deferred,
  constraint rev_questions_select_options check (
    type <> 'select' or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
  )
);

-- Bring a database that ran an earlier draft up to date.
alter table rev_questions add column if not exists worker_types text[] not null default array['paid', 'seconded', 'volunteer'];
alter table rev_questions drop constraint if exists rev_questions_worker_types;
alter table rev_questions add constraint rev_questions_worker_types check (
  cardinality(worker_types) > 0 and worker_types <@ array['paid', 'seconded', 'volunteer']
);

-- ─── GOALS AND MONTHLY CHECK-INS ─────────────────────────────────────────────

create table if not exists rev_goals (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text not null check (owner_email = lower(owner_email)),
  -- Fiscal year the goal belongs to, named by the year it ends in (FY2027 = Oct 2026 - Sep 2027).
  -- Fiscal year starts October 1; the UI derives the current FY from that.
  fiscal_year     int not null,
  title           text not null,
  description     text,
  success_measure text,
  target_value    numeric,
  unit            text,
  -- Goals are never deleted. A goal that is no longer being pursued is cancelled, which keeps its
  -- history visible to the manager and freezes it (see rev_block_cancelled).
  status          text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Bring a database that ran an earlier draft of this table up to date.
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'rev_goals' and column_name = 'cycle_year') then
    alter table rev_goals rename column cycle_year to fiscal_year;
  end if;
  alter table rev_goals add column if not exists cancelled_at timestamptz;
  alter table rev_goals add column if not exists cancel_reason text;
  alter table rev_goals drop constraint if exists rev_goals_status_check;
  update rev_goals set status = 'cancelled' where status = 'dropped';
  alter table rev_goals add constraint rev_goals_status_check check (status in ('active', 'completed', 'cancelled'));
end $$;

drop index if exists rev_goals_owner_idx;
create index if not exists rev_goals_owner_idx on rev_goals (owner_email, fiscal_year, status);

create table if not exists rev_checkins (
  id             uuid primary key default gen_random_uuid(),
  goal_id        uuid not null references rev_goals(id) on delete cascade,
  owner_email    text not null check (owner_email = lower(owner_email)),  -- copied from the goal, for RLS
  period_month   date not null check (period_month = date_trunc('month', period_month)::date),
  progress_value numeric,
  progress_pct   int check (progress_pct between 0 and 100),
  status         text not null check (status in ('on_track', 'at_risk', 'off_track', 'done')),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (goal_id, period_month)
);
create index if not exists rev_checkins_owner_idx on rev_checkins (owner_email, period_month);

-- ─── REVIEWS ─────────────────────────────────────────────────────────────────
-- draft -> with_manager -> awaiting_employee -> locked
-- (manager can send it back: with_manager -> draft)

create table if not exists rev_reviews (
  id              uuid primary key default gen_random_uuid(),
  employee_email  text not null check (employee_email = lower(employee_email)),
  manager_email   text check (manager_email = lower(manager_email)),  -- snapshot; null = top of tree
  kind            text not null check (kind in ('quarterly', 'annual')),
  period_year     int not null,
  period_quarter  int check (period_quarter between 1 and 4),
  template_id     uuid references rev_templates(id),
  questions       jsonb not null,   -- [{key, position, prompt, help_text, type, options, required}]
  employee_hours  text,             -- snapshot of the person's hours when the review was opened
  worker_type     text,             -- snapshot of paid / seconded / volunteer
  status          text not null default 'draft'
                    check (status in ('draft', 'with_manager', 'awaiting_employee', 'locked')),
  submitted_at    timestamptz,
  manager_done_at timestamptz,
  locked_at       timestamptz,
  content_hash    text,             -- sha256 of the final content, set at lock
  pdf_path        text,             -- storage path of the final PDF, set by the PDF step
  created_at      timestamptz not null default now(),
  constraint rev_reviews_period check (
    (kind = 'quarterly' and period_quarter is not null) or (kind = 'annual' and period_quarter is null)
  )
);
alter table rev_reviews add column if not exists employee_hours text;
alter table rev_reviews add column if not exists worker_type text;
create unique index if not exists rev_reviews_one_per_period
  on rev_reviews (employee_email, kind, period_year, coalesce(period_quarter, 0));
create index if not exists rev_reviews_manager_idx on rev_reviews (manager_email, status);

create table if not exists rev_answers (
  review_id    uuid not null references rev_reviews(id) on delete cascade,
  question_key text not null,
  value        text,
  updated_at   timestamptz not null default now(),
  primary key (review_id, question_key)
);

-- One manager response per question, in the same form as the question (see rev_validate_comment);
-- question_key '_overall' is the free-text summary comment.
create table if not exists rev_comments (
  review_id    uuid not null references rev_reviews(id) on delete cascade,
  question_key text not null,
  body         text not null,
  author_email text not null,
  updated_at   timestamptz not null default now(),
  primary key (review_id, question_key)
);

create table if not exists rev_signoffs (
  review_id      uuid primary key references rev_reviews(id),
  employee_email text not null,
  agreed         boolean not null,
  note           text,
  signed_at      timestamptz not null default now()
);

-- ─── REMINDER QUEUE ──────────────────────────────────────────────────────────
-- Rows are queued here; an edge function (service role) sends them via Resend.
-- Clients never send email directly.

create table if not exists rev_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('monthly_checkin', 'manager_digest', 'nudge')),
  recipient_email text not null,
  requested_by    text,
  period_month    date,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists rev_reminder_log_recipient_idx on rev_reminder_log (recipient_email, created_at desc);

-- Hierarchy lookups walk profiles by lowercased email. Harmless on the shared table.
create index if not exists profiles_lower_manager_email_idx on profiles (lower(manager_email));
create index if not exists profiles_lower_primary_email_idx on profiles (lower(primary_email));

-- ─── HELPERS ─────────────────────────────────────────────────────────────────
-- Authorization helpers never let NULL mean "allowed" (see License Manager pending/78).

create or replace function rev_me()
returns text language sql stable security definer set search_path = public as $$
  select lower(current_profile_email())
$$;

create or replace function rev_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(select 1 from rev_admins where email = lower(current_profile_email())), false)
$$;

create or replace function rev_is_direct_manager_of(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from profiles p
    where lower(p.primary_email) = lower(p_email)
      and lower(p.manager_email) = lower(current_profile_email())
  ), false)
$$;

-- Employee, the review's snapshot manager (once submitted), or an admin.
create or replace function rev_can_read_review(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id
      and (r.employee_email = rev_me()
           or (r.manager_email = rev_me() and r.status <> 'draft')
           or rev_is_admin())
  ), false)
$$;

-- Manager comments stay private until the manager sends the review back to the employee.
create or replace function rev_can_read_comments(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id
      and (rev_is_admin()
           or (r.manager_email = rev_me() and r.status <> 'draft')
           or (r.employee_email = rev_me() and r.status in ('awaiting_employee', 'locked')))
  ), false)
$$;

create or replace function rev_can_edit_answers(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id and r.employee_email = rev_me() and r.status = 'draft'
  ), false)
$$;

create or replace function rev_can_comment(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id and r.manager_email = rev_me() and r.status = 'with_manager'
  ), false)
$$;

-- ─── TRIGGERS ────────────────────────────────────────────────────────────────

create or replace function rev_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rev_touch on rev_templates;
create trigger rev_touch before update on rev_templates for each row execute function rev_touch_updated_at();
drop trigger if exists rev_touch on rev_goals;
create trigger rev_touch before update on rev_goals for each row execute function rev_touch_updated_at();
drop trigger if exists rev_touch on rev_checkins;
create trigger rev_touch before update on rev_checkins for each row execute function rev_touch_updated_at();
drop trigger if exists rev_touch on rev_answers;
create trigger rev_touch before update on rev_answers for each row execute function rev_touch_updated_at();
drop trigger if exists rev_touch on rev_comments;
create trigger rev_touch before update on rev_comments for each row execute function rev_touch_updated_at();

-- Locked reviews are immutable. Applies to every role, including RPCs and the
-- service role. (A database owner can still drop the trigger deliberately.)
create or replace function rev_block_locked()
returns trigger language plpgsql set search_path = public as $$
declare
  v_review_id uuid;
  v_status    text;
begin
  if tg_table_name = 'rev_reviews' then
    v_status := old.status;
  else
    if tg_op = 'DELETE' then v_review_id := old.review_id; else v_review_id := new.review_id; end if;
    select status into v_status from rev_reviews where id = v_review_id;
  end if;

  if v_status = 'locked' then
    raise exception 'This review is locked and cannot be changed' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists rev_block_locked on rev_reviews;
create trigger rev_block_locked before update or delete on rev_reviews
  for each row execute function rev_block_locked();
drop trigger if exists rev_block_locked on rev_answers;
create trigger rev_block_locked before insert or update or delete on rev_answers
  for each row execute function rev_block_locked();
drop trigger if exists rev_block_locked on rev_comments;
create trigger rev_block_locked before insert or update or delete on rev_comments
  for each row execute function rev_block_locked();
-- A cancelled goal is frozen: it cannot be edited or reopened, and takes no new check-ins.
create or replace function rev_block_cancelled() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'rev_goals' then
    if old.status = 'cancelled' then raise exception 'this goal was cancelled and cannot be changed'; end if;
  else
    if exists (select 1 from rev_goals g where g.id = new.goal_id and g.status = 'cancelled') then
      raise exception 'this goal was cancelled; check-ins are closed';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rev_block_cancelled on rev_goals;
create trigger rev_block_cancelled before update on rev_goals
  for each row execute function rev_block_cancelled();
drop trigger if exists rev_block_cancelled on rev_checkins;
create trigger rev_block_cancelled before insert or update on rev_checkins
  for each row execute function rev_block_cancelled();

-- Owner cancels one of their own active goals. A reason is optional: if given, the manager sees it.
create or replace function rev_cancel_goal(p_goal_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me text := lower(require_profile_email());
  g    rev_goals%rowtype;
begin
  select * into g from rev_goals where id = p_goal_id for update;
  if not found or g.owner_email is distinct from v_me then raise exception 'goal not found' using errcode = '42501'; end if;
  if g.status <> 'active' then raise exception 'only an active goal can be cancelled'; end if;

  update rev_goals
    set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(trim(p_reason), '')
    where id = g.id;
end;
$$;

-- A manager's response takes the same form as the question: a select question gets one of its
-- options, a short-text question gets a single line, a paragraph question gets free text.
-- '_overall' (the summary) is always free text.
create or replace function rev_validate_comment() returns trigger
language plpgsql set search_path = public as $$
declare
  q jsonb;
begin
  if new.question_key = '_overall' then return new; end if;

  select x into q
  from rev_reviews r, jsonb_array_elements(r.questions) x
  where r.id = new.review_id and x->>'key' = new.question_key;
  if q is null then raise exception 'unknown question %', new.question_key; end if;

  if q->>'type' = 'select' and not (q->'options') @> to_jsonb(new.body) then
    raise exception 'response must be one of the question''s choices';
  elsif q->>'type' = 'short_text' and (new.body ~ '[\r\n]' or length(new.body) > 255) then
    raise exception 'response must be a single line (255 characters or fewer)';
  end if;
  return new;
end;
$$;
drop trigger if exists rev_validate on rev_comments;
create trigger rev_validate before insert or update on rev_comments
  for each row execute function rev_validate_comment();

drop trigger if exists rev_block_locked on rev_signoffs;
create trigger rev_block_locked before insert or update or delete on rev_signoffs
  for each row execute function rev_block_locked();

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────

alter table rev_admins        enable row level security;
alter table rev_settings      enable row level security;
alter table rev_participants  enable row level security;
alter table rev_required_reviews enable row level security;
alter table rev_templates     enable row level security;
alter table rev_questions     enable row level security;
alter table rev_goals         enable row level security;
alter table rev_checkins      enable row level security;
alter table rev_reviews       enable row level security;
alter table rev_answers       enable row level security;
alter table rev_comments      enable row level security;
alter table rev_signoffs      enable row level security;
alter table rev_reminder_log  enable row level security;

-- Admin tables
drop policy if exists "rev_admins: admin all" on rev_admins;
create policy "rev_admins: admin all" on rev_admins for all
  using (rev_is_admin()) with check (rev_is_admin());

drop policy if exists "rev_settings: signed-in read" on rev_settings;
create policy "rev_settings: signed-in read" on rev_settings for select
  using (current_profile_id() is not null);
drop policy if exists "rev_settings: admin update" on rev_settings;
create policy "rev_settings: admin update" on rev_settings for update
  using (rev_is_admin()) with check (rev_is_admin());

drop policy if exists "rev_participants: admin all" on rev_participants;
create policy "rev_participants: admin all" on rev_participants for all
  using (rev_is_admin()) with check (rev_is_admin());

drop policy if exists "rev_required: signed-in read" on rev_required_reviews;
create policy "rev_required: signed-in read" on rev_required_reviews for select
  using (current_profile_id() is not null);
drop policy if exists "rev_required: admin write" on rev_required_reviews;
create policy "rev_required: admin write" on rev_required_reviews for all
  using (rev_is_admin()) with check (rev_is_admin());

drop policy if exists "rev_templates: signed-in read" on rev_templates;
create policy "rev_templates: signed-in read" on rev_templates for select
  using (current_profile_id() is not null);
drop policy if exists "rev_templates: admin write" on rev_templates;
create policy "rev_templates: admin write" on rev_templates for all
  using (rev_is_admin()) with check (rev_is_admin());

drop policy if exists "rev_questions: signed-in read" on rev_questions;
create policy "rev_questions: signed-in read" on rev_questions for select
  using (current_profile_id() is not null);
drop policy if exists "rev_questions: admin write" on rev_questions;
create policy "rev_questions: admin write" on rev_questions for all
  using (rev_is_admin()) with check (rev_is_admin());

-- Goals and check-ins: the owner and their DIRECT manager can read; only the owner writes.
drop policy if exists "rev_goals: read own or direct manager" on rev_goals;
create policy "rev_goals: read own or direct manager" on rev_goals for select
  using (owner_email = rev_me() or rev_is_direct_manager_of(owner_email));
drop policy if exists "rev_goals: insert own" on rev_goals;
create policy "rev_goals: insert own" on rev_goals for insert
  with check (owner_email = rev_me());
drop policy if exists "rev_goals: update own" on rev_goals;
create policy "rev_goals: update own" on rev_goals for update
  using (owner_email = rev_me()) with check (owner_email = rev_me());
-- No delete policy on purpose: goals are cancelled (rev_cancel_goal), never deleted.
drop policy if exists "rev_goals: delete own" on rev_goals;

drop policy if exists "rev_checkins: read own or direct manager" on rev_checkins;
create policy "rev_checkins: read own or direct manager" on rev_checkins for select
  using (owner_email = rev_me() or rev_is_direct_manager_of(owner_email));
drop policy if exists "rev_checkins: insert own" on rev_checkins;
create policy "rev_checkins: insert own" on rev_checkins for insert
  with check (
    owner_email = rev_me()
    and exists (select 1 from rev_goals g where g.id = goal_id and g.owner_email = rev_me())
  );
drop policy if exists "rev_checkins: update own" on rev_checkins;
create policy "rev_checkins: update own" on rev_checkins for update
  using (owner_email = rev_me()) with check (owner_email = rev_me());

-- Reviews: read only. All status changes go through the RPCs below.
drop policy if exists "rev_reviews: read" on rev_reviews;
create policy "rev_reviews: read" on rev_reviews for select
  using (rev_can_read_review(id));
revoke insert, update, delete on rev_reviews from authenticated, anon;

drop policy if exists "rev_answers: read" on rev_answers;
create policy "rev_answers: read" on rev_answers for select
  using (rev_can_read_review(review_id));
drop policy if exists "rev_answers: employee insert" on rev_answers;
create policy "rev_answers: employee insert" on rev_answers for insert
  with check (rev_can_edit_answers(review_id));
drop policy if exists "rev_answers: employee update" on rev_answers;
create policy "rev_answers: employee update" on rev_answers for update
  using (rev_can_edit_answers(review_id)) with check (rev_can_edit_answers(review_id));

drop policy if exists "rev_comments: read" on rev_comments;
create policy "rev_comments: read" on rev_comments for select
  using (rev_can_read_comments(review_id));
drop policy if exists "rev_comments: manager insert" on rev_comments;
create policy "rev_comments: manager insert" on rev_comments for insert
  with check (rev_can_comment(review_id) and author_email = rev_me());
drop policy if exists "rev_comments: manager update" on rev_comments;
create policy "rev_comments: manager update" on rev_comments for update
  using (rev_can_comment(review_id)) with check (rev_can_comment(review_id) and author_email = rev_me());

drop policy if exists "rev_signoffs: read" on rev_signoffs;
create policy "rev_signoffs: read" on rev_signoffs for select
  using (rev_can_read_review(review_id));
revoke insert, update, delete on rev_signoffs from authenticated, anon;

-- Reminder queue: admins can read; rows are written only by RPCs / the edge function.
drop policy if exists "rev_reminder_log: admin read" on rev_reminder_log;
create policy "rev_reminder_log: admin read" on rev_reminder_log for select
  using (rev_is_admin());
revoke insert, update, delete on rev_reminder_log from authenticated, anon;

-- ─── RPCs ────────────────────────────────────────────────────────────────────

-- Which required-reviews key a period maps to: q1/q2/q3, or annual.
create or replace function rev_review_key(p_kind text, p_quarter int)
returns text language sql immutable set search_path = public as $$
  select case when p_kind = 'annual' then 'annual' else 'q' || p_quarter end;
$$;

-- Admin: how many people a cycle would reach, before opening it.
--   eligible     = active, required to have this review, and not already holding one
--   not_required = active people whose hours make this review optional (skipped)
--   already_open = active people who already have this review
create or replace function rev_cycle_preview(p_kind text, p_year int, p_quarter int default null)
returns table (eligible int, not_required int, already_open int)
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
begin
  if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind = 'annual' then p_quarter := null; end if;
  v_key := rev_review_key(p_kind, p_quarter);

  return query
  select
    count(*) filter (where coalesce(rr.required, false) and r.id is null)::int,
    count(*) filter (where not coalesce(rr.required, false))::int,
    count(*) filter (where r.id is not null)::int
  from rev_participants pt
  left join rev_required_reviews rr on rr.hours = pt.hours and rr.review = v_key
  left join rev_reviews r on r.employee_email = pt.email and r.kind = p_kind
                          and r.period_year = p_year and coalesce(r.period_quarter, 0) = coalesce(p_quarter, 0)
  where pt.active;
end;
$$;

-- Admin: every (kind, period) cycle that has reviews, newest first, with totals.
-- There's no separate "cycle" table for a plain rev_open_cycle (no email, whole
-- organization); this reads the history straight back out of rev_reviews.
create or replace function rev_cycle_history()
returns table (kind text, period_year int, period_quarter int, opened_at timestamptz, total int, locked int)
language sql stable security definer set search_path = public as $$
  select kind, period_year, period_quarter, min(created_at), count(*)::int, count(*) filter (where status = 'locked')::int
  from rev_reviews
  where rev_is_admin()
  group by kind, period_year, period_quarter
  order by period_year desc, period_quarter desc nulls last, min(created_at) desc
$$;

-- Admin: create a review for every active participant who is REQUIRED to have it (by hours).
-- Each review snapshots the questions that apply to that person's worker type, their hours,
-- and their current manager. Returns how many reviews were created (people who already had one
-- are skipped).
create or replace function rev_open_cycle(p_kind text, p_year int, p_quarter int default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_me        text := lower(require_profile_email());
  v_template  rev_templates%rowtype;
  v_key       text;
  v_count     int;
begin
  if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_kind not in ('quarterly', 'annual') then
    raise exception 'kind must be quarterly or annual';
  end if;

  if p_kind = 'quarterly' then
    if p_quarter is null or p_quarter not between 1 and 4 then
      raise exception 'quarter must be 1-4 for a quarterly review';
    end if;
    if p_quarter = 4 and coalesce((select skip_q4_review from rev_settings where id = 1), true) then
      raise exception 'Q4 reviews are turned off in settings (the annual review covers Q4)';
    end if;
  else
    p_quarter := null;
  end if;
  v_key := rev_review_key(p_kind, p_quarter);

  select * into v_template from rev_templates where kind = p_kind and is_active;
  if not found then raise exception 'No active % template', p_kind; end if;
  if not exists (select 1 from rev_questions where template_id = v_template.id) then
    raise exception 'The active % template has no questions', p_kind;
  end if;

  -- A person whose worker type matches no question gets no review rather than an empty one.
  insert into rev_reviews (employee_email, manager_email, kind, period_year, period_quarter,
                           template_id, questions, employee_hours, worker_type)
  select pt.email, lower(nullif(trim(pr.manager_email), '')), p_kind, p_year, p_quarter,
         v_template.id, qs.questions, pt.hours, pt.worker_type
  from rev_participants pt
  join rev_required_reviews rr on rr.hours = pt.hours and rr.review = v_key and rr.required
  left join profiles pr on lower(pr.primary_email) = pt.email
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
             'key', q.id::text, 'position', q.position, 'prompt', q.prompt,
             'help_text', q.help_text, 'type', q.type, 'options', q.options,
             'required', q.required) order by q.position) as questions
    from rev_questions q
    where q.template_id = v_template.id and pt.worker_type = any (q.worker_types)
  ) qs
  where pt.active and qs.questions is not null
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Employee: send a draft to their manager. Required questions must be answered.
create or replace function rev_submit_review(p_review_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me      text := lower(require_profile_email());
  r         rev_reviews%rowtype;
  v_missing int;
  v_invalid int;
begin
  select * into r from rev_reviews where id = p_review_id for update;
  if not found or r.employee_email <> v_me then raise exception 'review not found' using errcode = '42501'; end if;
  if r.status <> 'draft' then raise exception 'only a draft can be submitted'; end if;
  if r.manager_email is null then raise exception 'No manager on file for you - ask an administrator'; end if;

  select count(*) into v_missing
  from jsonb_array_elements(r.questions) q
  where coalesce((q->>'required')::boolean, false)
    and not exists (
      select 1 from rev_answers a
      where a.review_id = r.id and a.question_key = q->>'key' and nullif(trim(a.value), '') is not null
    );
  if v_missing > 0 then
    raise exception '% required question(s) still need an answer', v_missing;
  end if;

  select count(*) into v_invalid
  from jsonb_array_elements(r.questions) q
  join rev_answers a on a.review_id = r.id and a.question_key = q->>'key'
  where q->>'type' = 'select'
    and nullif(trim(a.value), '') is not null
    and not (q->'options') @> to_jsonb(a.value);
  if v_invalid > 0 then
    raise exception '% answer(s) are not one of the allowed choices', v_invalid;
  end if;

  update rev_reviews
    set status = 'with_manager', submitted_at = now()
    where id = r.id;
end;
$$;

-- Submitting is final: there is deliberately no way to send a review back to draft.
-- (Drop is for databases that ran an earlier draft of this file.)
drop function if exists rev_return_review(uuid, text);
alter table rev_reviews drop column if exists returned_note;

-- Manager: finished commenting; hand it back to the employee to sign.
create or replace function rev_send_for_signoff(p_review_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me text := lower(require_profile_email());
  r    rev_reviews%rowtype;
begin
  select * into r from rev_reviews where id = p_review_id for update;
  if not found or r.manager_email is distinct from v_me then raise exception 'review not found' using errcode = '42501'; end if;
  if r.status <> 'with_manager' then raise exception 'review is not with the manager'; end if;

  update rev_reviews
    set status = 'awaiting_employee', manager_done_at = now()
    where id = r.id;
end;
$$;

-- Internal: hash of everything that makes up the final record. Not callable by clients.
create or replace function rev_compute_hash(p_review_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'review_id', r.id,
    'employee',  r.employee_email,
    'manager',   r.manager_email,
    'kind',      r.kind,
    'year',      r.period_year,
    'quarter',   r.period_quarter,
    'questions', r.questions,
    'answers',   (select coalesce(jsonb_object_agg(a.question_key, a.value), '{}'::jsonb)
                    from rev_answers a where a.review_id = r.id),
    'comments',  (select coalesce(jsonb_object_agg(c.question_key, c.body), '{}'::jsonb)
                    from rev_comments c where c.review_id = r.id),
    'agreed',    s.agreed,
    'signoff_note', s.note
  )::text, 'UTF8')), 'hex')
  from rev_reviews r
  join rev_signoffs s on s.review_id = r.id
  where r.id = p_review_id
$$;

-- Employee: sign off. Disagreeing is allowed but needs a note. Locks the review.
-- Returns the content hash; the PDF step stores the file and sets pdf_path.
create or replace function rev_sign_review(p_review_id uuid, p_agreed boolean, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_me   text := lower(require_profile_email());
  r      rev_reviews%rowtype;
  v_hash text;
begin
  select * into r from rev_reviews where id = p_review_id for update;
  if not found or r.employee_email <> v_me then raise exception 'review not found' using errcode = '42501'; end if;
  if r.status <> 'awaiting_employee' then raise exception 'review is not waiting for your sign-off'; end if;
  if p_agreed is null then raise exception 'choose agree or disagree'; end if;
  if not p_agreed and nullif(trim(p_note), '') is null then
    raise exception 'a note is required when you disagree';
  end if;

  insert into rev_signoffs (review_id, employee_email, agreed, note)
  values (r.id, v_me, p_agreed, nullif(trim(p_note), ''));

  v_hash := rev_compute_hash(r.id);

  update rev_reviews
    set status = 'locked', locked_at = now(), content_hash = v_hash
    where id = r.id;

  return v_hash;
end;
$$;

-- Admin: recompute the hash of a locked review and compare with the stored one.
create or replace function rev_verify_review(p_review_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_stored text;
begin
  perform require_profile_email();
  if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select content_hash into v_stored from rev_reviews where id = p_review_id and status = 'locked';
  if v_stored is null then raise exception 'review is not locked'; end if;
  return v_stored = rev_compute_hash(p_review_id);
end;
$$;

-- Admin: move an unlocked review to a different manager (e.g. mid-cycle manager change).
create or replace function rev_reassign_manager(p_review_id uuid, p_new_manager_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_new text := lower(nullif(trim(p_new_manager_email), ''));
begin
  perform require_profile_email();
  if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if v_new is null then raise exception 'new manager email is required'; end if;
  update rev_reviews set manager_email = v_new
    where id = p_review_id and status <> 'locked';
  if not found then raise exception 'review not found or already locked'; end if;
end;
$$;

-- Status-only view of reviews for the caller's whole reporting tree (direct and
-- indirect), or everyone for admins. Never returns answers or comments.
create or replace function rev_team_status()
returns table (
  employee_email text, display_name text, manager_email text, kind text,
  period_year int, period_quarter int, status text,
  submitted_at timestamptz, locked_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.employee_email, pr.display_name, r.manager_email, r.kind,
         r.period_year, r.period_quarter, r.status, r.submitted_at, r.locked_at
  from rev_reviews r
  left join profiles pr on lower(pr.primary_email) = r.employee_email
  where current_profile_email() is not null
    and (rev_is_admin() or r.employee_email in (select get_report_emails()))
  order by r.period_year desc, r.period_quarter desc nulls last, r.employee_email
$$;

-- The caller's whole reporting tree (direct and indirect) straight from the
-- directory, or everyone for admins. Unlike rev_team_status this doesn't
-- require a review to exist yet -- it's who reports to you, not review status.
create or replace function rev_team_roster()
returns table (employee_email text, display_name text, manager_email text, is_direct boolean, is_participant boolean)
language sql stable security definer set search_path = public as $$
  select lower(pr.primary_email), pr.display_name, lower(nullif(trim(pr.manager_email), '')),
         lower(nullif(trim(pr.manager_email), '')) = rev_me(),
         exists(select 1 from rev_participants rp where rp.email = lower(pr.primary_email) and rp.active)
  from profiles pr
  where current_profile_email() is not null
    and (rev_is_admin() or lower(pr.primary_email) in (select get_report_emails()))
  order by pr.display_name
$$;

-- Manager or admin: queue a reminder email for someone in their tree.
-- Returns false if that person was already nudged in the last 3 days (rate limit).
-- The edge function that sends queued rows checks nothing about who asked, so
-- all authorization happens here.
create or replace function rev_request_nudge(p_employee_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(require_profile_email());
  v_target text := lower(trim(p_employee_email));
begin
  if not (rev_is_admin() or v_target in (select get_report_emails())) then
    raise exception 'you can only send reminders to people on your team' using errcode = '42501';
  end if;

  if exists (
    select 1 from rev_reminder_log
    where kind = 'nudge' and recipient_email = v_target and created_at > now() - interval '3 days'
  ) then
    return false;
  end if;

  insert into rev_reminder_log (kind, recipient_email, requested_by)
  values ('nudge', v_target, v_me);
  return true;
end;
$$;

-- ─── FUNCTION PERMISSIONS ────────────────────────────────────────────────────
-- Postgres grants EXECUTE to everyone by default. Signed-in users only; the
-- hash helper is internal.

revoke execute on function
  rev_me(), rev_is_admin(), rev_is_direct_manager_of(text),
  rev_can_read_review(uuid), rev_can_read_comments(uuid),
  rev_can_edit_answers(uuid), rev_can_comment(uuid),
  rev_open_cycle(text, int, int), rev_submit_review(uuid), rev_cancel_goal(uuid, text), rev_cycle_preview(text, int, int), rev_cycle_history(), rev_review_key(text, int),
  rev_send_for_signoff(uuid), rev_sign_review(uuid, boolean, text), rev_compute_hash(uuid),
  rev_verify_review(uuid), rev_reassign_manager(uuid, text), rev_team_status(), rev_team_roster(),
  rev_request_nudge(text)
from public, anon;

revoke execute on function rev_compute_hash(uuid) from authenticated;

grant execute on function
  rev_me(), rev_is_admin(), rev_is_direct_manager_of(text),
  rev_can_read_review(uuid), rev_can_read_comments(uuid),
  rev_can_edit_answers(uuid), rev_can_comment(uuid),
  rev_open_cycle(text, int, int), rev_submit_review(uuid), rev_cancel_goal(uuid, text), rev_cycle_preview(text, int, int), rev_cycle_history(), rev_review_key(text, int),
  rev_send_for_signoff(uuid), rev_sign_review(uuid, boolean, text),
  rev_verify_review(uuid), rev_reassign_manager(uuid, text), rev_team_status(), rev_team_roster(),
  rev_request_nudge(text)
to authenticated;
