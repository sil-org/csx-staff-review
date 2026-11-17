-- Departments, department heads, super admins, and launching reviews for a whole department.
-- Run AFTER 01_rev_schema.sql. Re-runnable. If you re-run 01 on its own, re-run this file
-- afterwards: it redefines rev_can_read_review / rev_can_read_comments / rev_open_cycle.
--
-- MODEL
--   * rev_departments is a tree (parent_id). Each department has ONE head (head_email).
--   * A head reads the COMPLETED (locked) reviews of the people directly in the department they
--     head, read-only (never drafts, never edits). Heads further up the tree do NOT read those
--     reviews; they only see who has or has not submitted (rev_department_status / _report).
--   * Admins keep everything they had. Super admins are a subset of admins: only they can
--     create/move/rename departments, set heads and assign people to departments
--     (the fix-up path when the import got the structure wrong).
--   * A head (or an admin) can LAUNCH a review cycle for a department: reviews are created for
--     everyone beneath it who needs one, and each of them is emailed. The head edits the email
--     first (rich text, default text comes from rev_settings). A review is never created twice:
--     once it has been launched for someone, nobody else can launch it for them, so if a head
--     higher up already launched, a lower head's launch finds nothing left to send.

-- ─── SUPER ADMINS, DEPARTMENTS ───────────────────────────────────────────────

create table if not exists rev_super_admins (
  email      text primary key references rev_admins(email) on delete cascade,
  added_by   text not null,
  created_at timestamptz not null default now()
);

create table if not exists rev_departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  parent_id  uuid references rev_departments(id) on delete restrict,
  head_email text check (head_email is null or head_email = lower(head_email)),
  source     text not null default 'manual' check (source in ('import', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rev_departments_name_uq
  on rev_departments (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists rev_departments_parent_idx on rev_departments (parent_id);
create index if not exists rev_departments_head_idx on rev_departments (head_email);

alter table rev_participants add column if not exists department_id uuid references rev_departments(id) on delete set null;
create index if not exists rev_participants_dept_idx on rev_participants (department_id);

-- Default text for the launch email. {{name}} {{review}} {{link}} {{department}} are filled in per person.
alter table rev_settings add column if not exists launch_subject text not null default 'Your {{review}} is ready';
alter table rev_settings add column if not exists launch_body_html text not null default
  '<p>Hi {{name}},</p>'
  '<p>Your <strong>{{review}}</strong> is ready for you to start.</p>'
  '<ol><li>Open <a href="{{link}}">your review</a> and answer each question.</li>'
  '<li>Submit it when you are done. Submitting is final, so read it over first.</li>'
  '<li>Your manager will respond next, and then you will be asked to sign off.</li></ol>'
  '<p>Thank you!</p>';

-- A tree must stay a tree.
create or replace function rev_dept_no_cycle() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A department cannot be its own parent'; end if;
    if tg_op = 'UPDATE' and exists (
      with recursive up as (
        select id, parent_id from rev_departments where id = new.parent_id
        union
        select d.id, d.parent_id from rev_departments d join up on d.id = up.parent_id
      ) select 1 from up where id = new.id
    ) then
      raise exception 'That move would put a department inside itself';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists rev_dept_no_cycle on rev_departments;
create trigger rev_dept_no_cycle before insert or update on rev_departments
  for each row execute function rev_dept_no_cycle();

-- ─── HELPERS ─────────────────────────────────────────────────────────────────

create or replace function rev_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_super_admins s join rev_admins a on a.email = s.email
    where s.email = lower(current_profile_email())
  ), false)
$$;

-- The department and everything beneath it.
create or replace function rev_dept_subtree(p_dept uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive t as (
    select id from rev_departments where id = p_dept
    union
    select d.id from rev_departments d join t on d.parent_id = t.id
  ) select id from t
$$;

-- The department and everything above it.
create or replace function rev_dept_ancestors(p_dept uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive t as (
    select id, parent_id from rev_departments where id = p_dept
    union
    select d.id, d.parent_id from rev_departments d join t on d.id = t.parent_id
  ) select id from t
$$;

-- Am I the head of this department or of any department above it?
create or replace function rev_heads_dept(p_dept uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_departments d
    where d.id in (select rev_dept_ancestors(p_dept)) and d.head_email = rev_me()
  ), false)
$$;

-- Is this person directly in a department I head? (Not sub-departments: those have their own head.)
create or replace function rev_head_can_view(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_participants pt
    join rev_departments d on d.id = pt.department_id
    where pt.email = lower(p_email) and d.head_email = rev_me()
  ), false)
$$;

-- Heads read LOCKED reviews of the people directly in their department; nothing else changes.
create or replace function rev_can_read_review(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id
      and (r.employee_email = rev_me()
           or (r.manager_email = rev_me() and r.status <> 'draft')
           or rev_is_admin()
           or (r.status = 'locked' and rev_head_can_view(r.employee_email)))
  ), false)
$$;

create or replace function rev_can_read_comments(p_review_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists(
    select 1 from rev_reviews r
    where r.id = p_review_id
      and (rev_is_admin()
           or (r.manager_email = rev_me() and r.status <> 'draft')
           or (r.employee_email = rev_me() and r.status in ('awaiting_employee', 'locked'))
           or (r.status = 'locked' and rev_head_can_view(r.employee_email)))
  ), false)
$$;

-- Only super admins may put people into departments (SQL editor / import jobs are exempt).
create or replace function rev_guard_participant_dept() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and (tg_op = 'INSERT' and new.department_id is not null
          or tg_op = 'UPDATE' and new.department_id is distinct from old.department_id)
     and not rev_is_super_admin() then
    raise exception 'Only a super admin can assign departments' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists rev_guard_dept on rev_participants;
create trigger rev_guard_dept before insert or update on rev_participants
  for each row execute function rev_guard_participant_dept();

-- ─── LAUNCHES AND NOTICES ────────────────────────────────────────────────────

create table if not exists rev_launches (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid references rev_departments(id) on delete set null,  -- null = whole organization
  department_name text not null,                                          -- as it was at launch
  kind           text not null check (kind in ('quarterly', 'annual')),
  period_year    int not null,
  period_quarter int check (period_quarter between 1 and 4),
  launched_by    text not null,
  launched_at    timestamptz not null default now(),
  subject        text not null,
  body_html      text not null,
  created_count  int not null
);
create index if not exists rev_launches_cycle_idx on rev_launches (kind, period_year, period_quarter);

-- Launch emails use the same send queue as reminders.
alter table rev_reminder_log add column if not exists launch_id uuid references rev_launches(id) on delete set null;
alter table rev_reminder_log drop constraint if exists rev_reminder_log_kind_check;
alter table rev_reminder_log add constraint rev_reminder_log_kind_check
  check (kind in ('monthly_checkin', 'manager_digest', 'nudge', 'launch'));

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────

alter table rev_super_admins enable row level security;
alter table rev_departments  enable row level security;
alter table rev_launches     enable row level security;

drop policy if exists "rev_super_admins: read" on rev_super_admins;
create policy "rev_super_admins: read" on rev_super_admins for select using (rev_is_admin());
drop policy if exists "rev_super_admins: super write" on rev_super_admins;
create policy "rev_super_admins: super write" on rev_super_admins for all
  using (rev_is_super_admin()) with check (rev_is_super_admin());

-- Names and heads are not secret: everyone signed in may read the tree.
drop policy if exists "rev_departments: signed-in read" on rev_departments;
create policy "rev_departments: signed-in read" on rev_departments for select
  using (current_profile_email() is not null);
drop policy if exists "rev_departments: super write" on rev_departments;
create policy "rev_departments: super write" on rev_departments for all
  using (rev_is_super_admin()) with check (rev_is_super_admin());

drop policy if exists "rev_launches: read" on rev_launches;
create policy "rev_launches: read" on rev_launches for select
  using (rev_is_admin() or launched_by = rev_me()
         or (department_id is not null and (rev_heads_dept(department_id)
              or exists (select 1 from rev_departments d
                         where d.id in (select rev_dept_subtree(rev_launches.department_id)) and d.head_email = rev_me()))));
revoke insert, update, delete on rev_launches from authenticated, anon;

-- ─── CREATING REVIEWS (internal) ─────────────────────────────────────────────
-- Shared by rev_open_cycle (whole organization) and rev_launch_cycle (one department tree).
-- A person whose worker type matches no question gets no review rather than an empty one.

create or replace function rev_create_reviews(p_dept uuid, p_kind text, p_year int, p_quarter int)
returns table (employee_email text)
language plpgsql security definer set search_path = public as $$
declare
  v_template rev_templates%rowtype;
  v_key      text;
begin
  if p_kind not in ('quarterly', 'annual') then raise exception 'kind must be quarterly or annual'; end if;
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

  select * into v_template from rev_templates t where t.kind = p_kind and t.is_active;
  if not found then raise exception 'No active % template', p_kind; end if;
  if not exists (select 1 from rev_questions q where q.template_id = v_template.id) then
    raise exception 'The active % template has no questions', p_kind;
  end if;

  return query
  insert into rev_reviews as rv (employee_email, manager_email, kind, period_year, period_quarter,
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
    and (p_dept is null or pt.department_id in (select rev_dept_subtree(p_dept)))
  on conflict do nothing
  returning rv.employee_email;
end;
$$;

-- Admin: create reviews for everyone who needs one (whole organization, no email).
create or replace function rev_open_cycle(p_kind text, p_year int, p_quarter int default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select count(*) into v_count from rev_create_reviews(null, p_kind, p_year, p_quarter);
  return v_count;
end;
$$;

-- ─── LAUNCH: PREVIEW, SEND, REPORT ───────────────────────────────────────────

-- Before sending: how many people would get a review, and who already launched this cycle for this
-- part of the tree. p_dept null = the whole organization (admins only).
create or replace function rev_launch_preview(p_dept uuid, p_kind text, p_year int, p_quarter int default null)
returns table (eligible int, already_open int, not_required int, prior_launches jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_key text;
begin
  if p_dept is null then
    if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  elsif not (rev_is_admin() or rev_heads_dept(p_dept)) then
    raise exception 'only the head of this department can launch reviews' using errcode = '42501';
  end if;
  if p_kind = 'annual' then p_quarter := null; end if;
  v_key := rev_review_key(p_kind, p_quarter);

  return query
  select
    (count(*) filter (where coalesce(rr.required, false) and r.id is null))::int,
    (count(*) filter (where r.id is not null))::int,
    (count(*) filter (where not coalesce(rr.required, false)))::int,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'department', l.department_name, 'launched_by', l.launched_by,
               'launched_at', l.launched_at, 'created', l.created_count) order by l.launched_at)
      from rev_launches l
      where l.kind = p_kind and l.period_year = p_year
        and coalesce(l.period_quarter, 0) = coalesce(p_quarter, 0)
        and (l.department_id is null
             or p_dept is null
             or l.department_id in (select rev_dept_ancestors(p_dept))
             or l.department_id in (select rev_dept_subtree(p_dept)))
    ), '[]'::jsonb)
  from rev_participants pt
  left join rev_required_reviews rr on rr.hours = pt.hours and rr.review = v_key
  left join rev_reviews r on r.employee_email = pt.email and r.kind = p_kind
                          and r.period_year = p_year and coalesce(r.period_quarter, 0) = coalesce(p_quarter, 0)
  where pt.active and (p_dept is null or pt.department_id in (select rev_dept_subtree(p_dept)));
end;
$$;

-- Head (of this department or any above it) or admin: create the reviews and queue one email per person who
-- got one. People who already have this review are skipped. Subject and body are rich text (HTML) already edited by the sender; {{name}} {{review}}
-- {{link}} {{department}} are filled in per recipient by the sending function, which also
-- sanitizes the HTML (the checks here are only a first line of defence).
create or replace function rev_launch_cycle(p_dept uuid, p_kind text, p_year int, p_quarter int,
                                            p_subject text, p_body_html text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_me        text := lower(require_profile_email());
  v_dept_name text;
  v_emails    text[];
  v_count     int;
  v_launch    uuid;
begin
  if p_dept is null then
    if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
    v_dept_name := 'the whole organization';
  else
    if not (rev_is_admin() or rev_heads_dept(p_dept)) then
      raise exception 'only the head of this department can launch reviews' using errcode = '42501';
    end if;
    select name into v_dept_name from rev_departments where id = p_dept;
    if v_dept_name is null then raise exception 'department not found'; end if;
  end if;

  if nullif(trim(p_subject), '') is null or nullif(trim(p_body_html), '') is null then
    raise exception 'The email needs a subject and a message';
  end if;
  if p_body_html ~* '<\s*(script|iframe|object|embed)' or p_body_html ~* '\son[a-z]+\s*=' or p_body_html ~* 'javascript:' then
    raise exception 'The email contains markup that is not allowed';
  end if;
  if p_kind = 'annual' then p_quarter := null; end if;

  select array_agg(c.employee_email) into v_emails from rev_create_reviews(p_dept, p_kind, p_year, p_quarter) c;
  v_count := coalesce(cardinality(v_emails), 0);
  if v_count = 0 then
    raise exception 'Nothing to send: everyone in % who needs this review already has it', v_dept_name;
  end if;

  insert into rev_launches (department_id, department_name, kind, period_year, period_quarter,
                            launched_by, subject, body_html, created_count)
  values (p_dept, v_dept_name, p_kind, p_year, p_quarter, v_me, p_subject, p_body_html, v_count)
  returning id into v_launch;

  insert into rev_reminder_log (kind, recipient_email, requested_by, launch_id)
  select 'launch', e, v_me, v_launch from unnest(v_emails) e;

  return v_count;
end;
$$;

-- Heads and admins: counts for a department and every department under it, each rolled up
-- through its own sub-departments. Counts only, no review content.
create or replace function rev_department_report(p_dept uuid, p_kind text, p_year int, p_quarter int default null)
returns table (department_id uuid, name text, parent_id uuid, head_email text, depth int,
               people int, drafts int, with_manager int, awaiting_employee int, locked int)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_dept is null then
    if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  elsif not (rev_is_admin() or rev_heads_dept(p_dept)) then
    raise exception 'only the head of this department can see this report' using errcode = '42501';
  end if;
  if p_kind = 'annual' then p_quarter := null; end if;

  return query
  with recursive tree as (
    select d.id, d.name, d.parent_id, d.head_email, 0 as depth from rev_departments d
    where (p_dept is null and d.parent_id is null) or d.id = p_dept
    union all
    select c.id, c.name, c.parent_id, c.head_email, t.depth + 1 from rev_departments c join tree t on c.parent_id = t.id
  )
  select t.id, t.name, t.parent_id, t.head_email, t.depth,
         (select count(*) from rev_participants pt
           where pt.active and pt.department_id in (select rev_dept_subtree(t.id)))::int,
         (count(*) filter (where r.status = 'draft'))::int,
         (count(*) filter (where r.status = 'with_manager'))::int,
         (count(*) filter (where r.status = 'awaiting_employee'))::int,
         (count(*) filter (where r.status = 'locked'))::int
  from tree t
  left join rev_participants pt on pt.department_id in (select rev_dept_subtree(t.id)) and pt.active
  left join rev_reviews r on r.employee_email = pt.email and r.kind = p_kind
                          and r.period_year = p_year and coalesce(r.period_quarter, 0) = coalesce(p_quarter, 0)
  group by t.id, t.name, t.parent_id, t.head_email, t.depth
  order by t.depth, t.name;
end;
$$;

-- Heads and admins: who has or has not submitted, per person, for everyone beneath a department.
-- Status only, never review content.
create or replace function rev_department_status(p_dept uuid, p_kind text, p_year int, p_quarter int default null)
returns table (employee_email text, display_name text, department_name text, status text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_dept is null then
    if not rev_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  elsif not (rev_is_admin() or rev_heads_dept(p_dept)) then
    raise exception 'only the head of this department can see this' using errcode = '42501';
  end if;
  if p_kind = 'annual' then p_quarter := null; end if;

  return query
  select pt.email, pr.display_name, d.name, coalesce(r.status, 'not_started')
  from rev_participants pt
  left join rev_departments d on d.id = pt.department_id
  left join profiles pr on lower(pr.primary_email) = pt.email
  left join rev_reviews r on r.employee_email = pt.email and r.kind = p_kind
                          and r.period_year = p_year and coalesce(r.period_quarter, 0) = coalesce(p_quarter, 0)
  where pt.active and (p_dept is null or pt.department_id in (select rev_dept_subtree(p_dept)))
  order by d.name, pr.display_name;
end;
$$;

-- ─── FUNCTION PERMISSIONS ────────────────────────────────────────────────────

revoke execute on function
  rev_is_super_admin(), rev_dept_subtree(uuid), rev_dept_ancestors(uuid), rev_heads_dept(uuid),
  rev_head_can_view(text), rev_create_reviews(uuid, text, int, int),
  rev_launch_preview(uuid, text, int, int), rev_launch_cycle(uuid, text, int, int, text, text),
  rev_department_report(uuid, text, int, int), rev_department_status(uuid, text, int, int), rev_open_cycle(text, int, int)
from public, anon;

-- Internal only: rev_create_reviews skips the permission checks its callers perform.
revoke execute on function rev_create_reviews(uuid, text, int, int) from authenticated;

grant execute on function
  rev_is_super_admin(), rev_dept_subtree(uuid), rev_dept_ancestors(uuid), rev_heads_dept(uuid),
  rev_head_can_view(text),
  rev_launch_preview(uuid, text, int, int), rev_launch_cycle(uuid, text, int, int, text, text),
  rev_department_report(uuid, text, int, int), rev_department_status(uuid, text, int, int), rev_open_cycle(text, int, int)
to authenticated;
