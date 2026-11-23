\set ON_ERROR_STOP 1
\set hr    '00000000-0000-0000-0000-000000000001'
\set dave  '00000000-0000-0000-0000-000000000002'
\set kate  '00000000-0000-0000-0000-000000000003'
\set bob   '00000000-0000-0000-0000-000000000004'
\set carol '00000000-0000-0000-0000-000000000005'
\set eve   '00000000-0000-0000-0000-000000000006'

-- ── A. admin opens a cycle ──────────────────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare n int; e text;
begin
  n := rev_open_cycle('quarterly', 2026, 1);
  assert n = 3, 'opened 3, got ' || n;
  n := rev_open_cycle('quarterly', 2026, 1);
  assert n = 0, 'second open creates 0, got ' || n;
  begin perform rev_open_cycle('quarterly', 2026, 4); exception when others then e := sqlerrm; end;
  assert e like 'Q4 reviews are turned off%', 'Q4 blocked: ' || coalesce(e, 'no error');
  assert (select count(*) from rev_reviews) = 3, 'admin sees all 3 reviews';
  raise notice 'A ok: cycle opening, idempotent, Q4 skipped';
end $$;
reset role;
create table test_ids as select employee_email, id from rev_reviews;
grant select on test_ids to authenticated;

set role authenticated;
set request.jwt.claim.sub = :'bob';
do $$ declare e text;
begin
  begin perform rev_open_cycle('quarterly', 2026, 2); exception when others then e := sqlerrm; end;
  assert e = 'admin only', 'non-admin cannot open cycle: ' || coalesce(e, 'no error');
  raise notice 'A2 ok: non-admin cannot open a cycle';
end $$;

-- ── B. employee fills and submits ───────────────────────────────────────────
do $$ declare r rev_reviews%rowtype; k1 text; k2 text; k3 text; e text; n int; carol_id uuid;
begin
  assert (select count(*) from rev_reviews) = 1, 'bob sees only his own review';
  select * into r from rev_reviews;
  select q->>'key' into k1 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 1;
  select q->>'key' into k2 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 2;
  select id into carol_id from test_ids where employee_email = 'carol@sil.org';

  begin update rev_reviews set status = 'locked' where id = r.id; exception when others then e := sqlerrm; end;
  assert e like 'permission denied%', 'direct status write denied: ' || coalesce(e, 'no error');

  e := null;
  begin insert into rev_answers (review_id, question_key, value) values (carol_id, k1, 'sneaky'); exception when others then e := sqlerrm; end;
  assert e is not null, 'cannot answer someone else''s review';

  e := null;
  begin perform rev_submit_review(r.id); exception when others then e := sqlerrm; end;
  assert e like '2 required question(s)%', 'missing required blocked: ' || coalesce(e, 'no error');

  insert into rev_answers (review_id, question_key, value) values (r.id, k1, 'Shipped the thing'), (r.id, k2, 'Nope');
  e := null;
  begin perform rev_submit_review(r.id); exception when others then e := sqlerrm; end;
  assert e like '1 answer(s) are not one of the allowed choices%', 'bad select blocked: ' || coalesce(e, 'no error');

  update rev_answers set value = 'Meets' where review_id = r.id and question_key = k2;
  perform rev_submit_review(r.id);
  assert (select status from rev_reviews where id = r.id) = 'with_manager', 'submitted';

  update rev_answers set value = 'edited after submit' where review_id = r.id and question_key = k1;
  get diagnostics n = row_count;
  assert n = 0, 'cannot edit answers after submit, changed ' || n;
  raise notice 'B ok: required + select validation, submit, read-only after submit';
end $$;

-- carol submits (final: there is no send-back)
set request.jwt.claim.sub = :'carol';
do $$ declare r rev_reviews%rowtype; k1 text; k2 text;
begin
  select * into r from rev_reviews;
  select q->>'key' into k1 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 1;
  select q->>'key' into k2 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 2;
  insert into rev_answers (review_id, question_key, value) values (r.id, k1, 'ok'), (r.id, k2, 'Below');
  perform rev_submit_review(r.id);
end $$;

-- ── C. manager visibility, send-back, comments ──────────────────────────────
set request.jwt.claim.sub = :'bob';   -- bob is carol's manager
do $$ declare r rev_reviews%rowtype; e text;
begin
  assert (select count(*) from rev_reviews) = 2, 'bob sees his own + carol (his report), got ' || (select count(*) from rev_reviews);
  select * into r from rev_reviews where employee_email = 'carol@sil.org';
  assert r.status = 'with_manager', 'carol review is with the manager';
  assert (select count(*) from rev_answers) = 4, 'bob sees his own two answers + carol''s two, got ' || (select count(*) from rev_answers);
  assert not exists (select 1 from pg_proc where proname = 'rev_return_review'), 'send-back function must not exist';
  raise notice 'C1 ok: submitted review visible to manager, no send-back function';
end $$;

set request.jwt.claim.sub = :'carol';
do $$ declare r rev_reviews%rowtype; e text;
begin
  select * into r from rev_reviews;
  assert r.status = 'with_manager' and r.submitted_at is not null, 'carol review stays submitted';
  begin update rev_answers set value = 'changed' where review_id = r.id; exception when others then e := sqlerrm; end;
  assert (select count(*) from rev_answers where value = 'changed') = 0, 'carol cannot edit after submit';
  e := null;
  begin perform rev_submit_review(r.id); exception when others then e := sqlerrm; end;
  assert e = 'only a draft can be submitted', 'cannot resubmit: ' || coalesce(e,'no error');
  raise notice 'C1b ok: employee cannot edit or resubmit after submit';
end $$;

set request.jwt.claim.sub = :'kate';  -- kate is bob's manager, carol's skip-level
do $$ declare r rev_reviews%rowtype; k1 text; k2 text; e text; n int;
begin
  assert (select count(*) from rev_reviews) = 1, 'kate sees only bob''s review, got ' || (select count(*) from rev_reviews);
  select * into r from rev_reviews;
  assert r.employee_email = 'bob@sil.org', 'it is bob''s';
  assert (select count(*) from rev_answers) = 2, 'kate reads bob''s answers';
  select q->>'key' into k1 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 1;
  select q->>'key' into k2 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 2;

  begin insert into rev_comments (review_id, question_key, body, author_email) values (r.id, k1, 'x', 'someone@sil.org'); exception when others then e := sqlerrm; end;
  assert e is not null, 'cannot comment as someone else';

  insert into rev_comments (review_id, question_key, body, author_email) values (r.id, k1, 'Agree - nice work', 'kate@sil.org');

  -- manager response must match question type (k2 is a select)
  e := null;
  begin insert into rev_comments (review_id, question_key, body, author_email) values (r.id, k2, 'a long paragraph, not a choice', 'kate@sil.org'); exception when others then e := sqlerrm; end;
  assert e like 'response must be one of%', 'select question rejects free text: ' || coalesce(e, 'no error');
  begin
    insert into rev_comments (review_id, question_key, body, author_email) values (r.id, k2, 'Below', 'kate@sil.org');
    raise exception 'rollback-probe';
  exception when others then e := sqlerrm; end;
  assert e = 'rollback-probe', 'select question accepts a valid option: ' || coalesce(e, 'no error');
  raise notice 'C2a ok: manager response follows question type';

  select count(*) into n from rev_team_status();
  assert n = 2, 'kate team status = bob + carol, got ' || n;
  assert (select status from rev_team_status() where employee_email = 'carol@sil.org') = 'with_manager', 'carol is with manager';
  raise notice 'C2 ok: manager reads answers, comments, tree status';
end $$;

set request.jwt.claim.sub = :'bob';
do $$ begin
  assert (select count(*) from rev_comments) = 0, 'employee cannot see comments before manager is done';
  raise notice 'C3 ok: comments hidden from employee until sent back';
end $$;

set request.jwt.claim.sub = :'kate';
do $$ declare r rev_reviews%rowtype; k2 text; e text;
begin
  select * into r from rev_reviews;
  perform rev_send_for_signoff(r.id);
  select q->>'key' into k2 from jsonb_array_elements(r.questions) q where (q->>'position')::int = 2;
  begin insert into rev_comments (review_id, question_key, body, author_email) values (r.id, k2, 'late', 'kate@sil.org'); exception when others then e := sqlerrm; end;
  assert e is not null, 'manager cannot comment after sending for sign-off';
  raise notice 'C4 ok: no comments after hand-off';
end $$;

-- ── D. sign-off, lock, immutability, tamper detection ───────────────────────
set request.jwt.claim.sub = :'bob';
do $$ declare r rev_reviews%rowtype; e text; h text;
begin
  assert (select count(*) from rev_comments) = 1, 'employee now sees the comment';
  select * into r from rev_reviews where employee_email = 'bob@sil.org';
  begin perform rev_sign_review(r.id, false, ''); exception when others then e := sqlerrm; end;
  assert e like 'a note is required%', 'disagree needs a note: ' || coalesce(e, 'no error');
  h := rev_sign_review(r.id, false, 'I disagree with the rating');
  assert length(h) = 64, 'hash returned';
  select * into r from rev_reviews where employee_email = 'bob@sil.org';
  assert r.status = 'locked' and r.content_hash = h and r.locked_at is not null, 'locked with hash';
  assert (select agreed from rev_signoffs where review_id = r.id) = false, 'disagreement recorded';
  raise notice 'D1 ok: sign-off with disagreement locks the review';
end $$;

reset role;
do $$ declare e text; id_ uuid;
begin
  select id into id_ from test_ids where employee_email = 'bob@sil.org';
  begin update rev_answers set value = 'tamper' where review_id = id_; exception when others then e := sqlerrm; end;
  assert e like 'This review is locked%', 'superuser answer edit blocked: ' || coalesce(e, 'no error');
  e := null;
  begin delete from rev_comments where review_id = id_; exception when others then e := sqlerrm; end;
  assert e like 'This review is locked%', 'comment delete blocked';
  e := null;
  begin update rev_reviews set manager_email = 'x@sil.org' where id = id_; exception when others then e := sqlerrm; end;
  assert e like 'This review is locked%', 'review update blocked';
  e := null;
  begin delete from rev_reviews where id = id_; exception when others then e := sqlerrm; end;
  assert e like 'This review is locked%', 'review delete blocked';
  raise notice 'D2 ok: locked review is immutable even for the database owner';
end $$;

set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare id_ uuid;
begin
  select id into id_ from test_ids where employee_email = 'bob@sil.org';
  assert rev_verify_review(id_) = true, 'hash verifies';
end $$;
reset role;
alter table rev_answers disable trigger rev_block_locked;
update rev_answers set value = 'tampered' where review_id = (select id from test_ids where employee_email = 'bob@sil.org') and value = 'Meets';
alter table rev_answers enable trigger rev_block_locked;
set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare id_ uuid;
begin
  select id into id_ from test_ids where employee_email = 'bob@sil.org';
  assert rev_verify_review(id_) = false, 'tampering detected by hash';
  raise notice 'D3 ok: verify detects a tampered record';
end $$;

-- ── E. skip-level and bystanders ────────────────────────────────────────────
set request.jwt.claim.sub = :'dave';
do $$ begin
  assert (select count(*) from rev_reviews) = 0, 'skip-level sees no review content';
  assert (select count(*) from rev_answers) = 0, 'skip-level sees no answers';
  assert (select count(*) from rev_comments) = 0, 'skip-level sees no comments';
  assert (select count(*) from rev_team_status()) = 3, 'skip-level sees status for whole tree, got ' || (select count(*) from rev_team_status());
  raise notice 'E1 ok: skip-level gets status only';
end $$;

set request.jwt.claim.sub = :'carol';
do $$ begin
  assert (select count(*) from rev_reviews) = 1, 'carol sees only her own';
  assert (select count(*) from rev_team_status()) = 0, 'carol manages no one';
  raise notice 'E2 ok: employee sees only their own';
end $$;

-- ── F. goals and check-ins ──────────────────────────────────────────────────
set request.jwt.claim.sub = :'bob';
do $$ declare g uuid; e text;
begin
  insert into rev_goals (owner_email, fiscal_year, title) values ('bob@sil.org', 2027, 'Ship v1') returning id into g;
  begin insert into rev_goals (owner_email, fiscal_year, title) values ('carol@sil.org', 2027, 'not mine'); exception when others then e := sqlerrm; end;
  assert e is not null, 'cannot create a goal for someone else';
  insert into rev_checkins (goal_id, owner_email, period_month, progress_pct, status) values (g, 'bob@sil.org', '2026-11-01', 40, 'on_track');
  e := null;
  begin insert into rev_checkins (goal_id, owner_email, period_month, status) values (g, 'bob@sil.org', '2026-11-15', 'on_track'); exception when others then e := sqlerrm; end;
  assert e is not null, 'period_month must be the first of the month';
  raise notice 'F1 ok: owner writes goals and check-ins';
end $$;

set request.jwt.claim.sub = :'kate';
do $$ begin
  assert (select count(*) from rev_goals) = 1 and (select count(*) from rev_checkins) = 1, 'direct manager sees goal + check-in';
  raise notice 'F2 ok: direct manager reads goals';
end $$;

set request.jwt.claim.sub = :'carol';
do $$ declare g uuid; e text;
begin
  assert (select count(*) from rev_goals) = 0, 'peer/other cannot see bob''s goal';
  select id into g from rev_goals limit 1;
  raise notice 'F3 ok: others cannot read goals';
end $$;

set request.jwt.claim.sub = :'dave';
do $$ begin
  assert (select count(*) from rev_goals) = 0, 'skip-level cannot see goals';
  raise notice 'F4 ok: skip-level cannot read goals';
end $$;

-- ── F5. cancelling goals ────────────────────────────────────────────────────
set request.jwt.claim.sub = :'bob';
do $$ declare g uuid; g2 uuid; e text;
begin
  select id into g from rev_goals where owner_email = 'bob@sil.org' limit 1;
  perform rev_cancel_goal(g, 'Project was reassigned');
  assert (select status from rev_goals where id = g) = 'cancelled', 'goal cancelled';
  assert (select cancel_reason from rev_goals where id = g) = 'Project was reassigned', 'reason stored when given';
  e := null;
  begin insert into rev_checkins (goal_id, owner_email, period_month, status) values (g, 'bob@sil.org', '2026-12-01', 'on_track'); exception when others then e := sqlerrm; end;
  assert e like 'this goal was cancelled%', 'no check-in on a cancelled goal: ' || coalesce(e, 'no error');
  e := null;
  begin update rev_goals set status = 'active' where id = g; exception when others then e := sqlerrm; end;
  assert e like 'this goal was cancelled%', 'cannot reopen: ' || coalesce(e, 'no error');
  e := null;
  begin perform rev_cancel_goal(g, 'again'); exception when others then e := sqlerrm; end;
  assert e is not null, 'cannot cancel twice';
  delete from rev_goals where id = g;
  assert (select count(*) from rev_goals) = 1, 'goals cannot be deleted';

  insert into rev_goals (owner_email, fiscal_year, title) values ('bob@sil.org', 2027, 'No reason needed') returning id into g2;
  perform rev_cancel_goal(g2, '   ');
  assert (select status from rev_goals where id = g2) = 'cancelled', 'goal cancelled with no reason given';
  assert (select cancel_reason from rev_goals where id = g2) is null, 'a blank reason is stored as null, not required';
  raise notice 'F5 ok: cancel reason is optional, freezes the goal, no delete';
end $$;

set request.jwt.claim.sub = :'carol';
do $$ declare g uuid; e text;
begin
  select id into g from rev_goals limit 1;
  assert g is null, 'carol sees no goals';
  begin perform rev_cancel_goal((select id from rev_goals limit 1), 'x'); exception when others then e := sqlerrm; end;
  raise notice 'F6 ok: other users cannot reach the goal';
end $$;

set request.jwt.claim.sub = :'kate';
do $$ begin
  assert (select cancel_reason from rev_goals where title = 'Ship v1') = 'Project was reassigned', 'manager sees cancelled goal and reason';
  assert (select status from rev_goals where title = 'No reason needed') = 'cancelled'
     and (select cancel_reason from rev_goals where title = 'No reason needed') is null, 'manager sees cancelled goal with no reason';
  raise notice 'F7 ok: manager still sees cancelled goals, with or without a reason';
end $$;

-- ── G. nudges ───────────────────────────────────────────────────────────────
set request.jwt.claim.sub = :'kate';
do $$ declare e text;
begin
  assert rev_request_nudge('bob@sil.org') = true, 'first nudge queued';
  assert rev_request_nudge('Bob@sil.org') = false, 'second nudge within 3 days rate-limited';
  assert rev_request_nudge('carol@sil.org') = true, 'manager can nudge a skip-level report';
  begin perform rev_request_nudge('eve@sil.org'); exception when others then e := sqlerrm; end;
  assert e like 'you can only send reminders%', 'cannot nudge outside tree: ' || coalesce(e, 'no error');
  e := null;
  begin insert into rev_reminder_log (kind, recipient_email) values ('nudge', 'eve@sil.org'); exception when others then e := sqlerrm; end;
  assert e like 'permission denied%', 'no direct writes to reminder queue: ' || coalesce(e, 'no error');
  raise notice 'G ok: nudges authorized, rate limited, queue not directly writable';
end $$;

-- ── I. hours decide which reviews, worker type decides which questions ──────
-- Worker type is derived from profiles.employee_type (rev_worker_type()), not set on
-- rev_participants: 'volunteer' -> volunteer, 'member' -> seconded ("Supported" in the UI).
reset role;
update rev_participants set hours = 'part_time' where email = 'eve@sil.org';
update profiles set employee_type = 'volunteer' where primary_email = 'eve@sil.org';
update profiles set employee_type = 'member' where primary_email = 'carol@sil.org';
-- a question only paid staff are asked, on the annual template
insert into rev_questions (template_id, position, prompt, type, required, worker_types)
select id, 2, 'Salary-related development plan', 'paragraph', false, array['paid'] from rev_templates where kind = 'annual';

set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare n int; p record; e text;
begin
  -- Q2: full-time people only (bob, carol); eve is part-time so not required
  select * into p from rev_cycle_preview('quarterly', 2026, 2);
  assert p.eligible = 2 and p.not_required = 1 and p.already_open = 0, format('preview Q2: %s/%s/%s', p.eligible, p.not_required, p.already_open);
  n := rev_open_cycle('quarterly', 2026, 2);
  assert n = 2, 'Q2 reaches 2 full-time people, got ' || n;
  assert not exists (select 1 from rev_reviews where employee_email = 'eve@sil.org' and period_quarter = 2), 'part-time eve has no Q2 review';
  select * into p from rev_cycle_preview('quarterly', 2026, 2);
  assert p.eligible = 0 and p.already_open = 2, 'preview after opening';

  -- Annual: everyone is required; the paid-only question reaches bob only
  n := rev_open_cycle('annual', 2026);
  assert n = 3, 'annual reaches all 3, got ' || n;
  assert (select jsonb_array_length(questions) from rev_reviews where employee_email = 'bob@sil.org' and kind = 'annual') = 2, 'paid bob gets 2 annual questions';
  assert (select jsonb_array_length(questions) from rev_reviews where employee_email = 'carol@sil.org' and kind = 'annual') = 1, 'seconded carol gets 1';
  assert (select jsonb_array_length(questions) from rev_reviews where employee_email = 'eve@sil.org' and kind = 'annual') = 1, 'volunteer eve gets 1';
  assert (select employee_hours || '/' || worker_type from rev_reviews where employee_email = 'eve@sil.org' and kind = 'annual') = 'part_time/volunteer', 'snapshot of hours and worker type';

  -- admin flips the matrix: part-time now needs Q3
  update rev_required_reviews set required = true where hours = 'part_time' and review = 'q3';
  n := rev_open_cycle('quarterly', 2026, 3);
  assert n = 3, 'Q3 now reaches part-time too, got ' || n;

  -- Q4 once the org turns the skip off: full-time only
  update rev_settings set skip_q4_review = false where id = 1;
  n := rev_open_cycle('quarterly', 2026, 4);
  assert n = 2, 'Q4 reaches full-time only, got ' || n;
  update rev_settings set skip_q4_review = true where id = 1;

  -- validation
  assert rev_worker_type('contractor') is null, 'unrecognized employee_type maps to no worker type, not an error';
  assert rev_worker_type(null) = 'seconded', 'no employee_type on file yet defaults to Supported';
  begin insert into rev_questions (template_id, position, prompt, type, worker_types) select id, 9, 'x', 'paragraph', array[]::text[] from rev_templates limit 1; exception when others then e := sqlerrm; end;
  assert e is not null, 'empty audience rejected';
  raise notice 'I1 ok: required reviews follow hours; questions follow worker type';
end $$;

set request.jwt.claim.sub = :'bob';
do $$ declare e text;
begin
  begin update rev_required_reviews set required = false where hours = 'full_time'; exception when others then e := sqlerrm; end;
  assert (select count(*) from rev_required_reviews where required) = 7, 'non-admin cannot change the matrix';
  begin perform rev_cycle_preview('annual', 2026); exception when others then e := sqlerrm; end;
  assert e like 'admin only%', 'non-admin cannot preview: ' || coalesce(e, 'no error');
  raise notice 'I2 ok: only admins manage the matrix';
end $$;

-- a contingent worker is a participant like anyone else, but never gets a review
reset role;
insert into profiles (display_name, primary_email, manager_email, employee_type) values
  ('Frank', 'frank@sil.org', 'kate@sil.org', 'contingent');
insert into rev_participants (email, added_by, hours) values
  ('frank@sil.org', 'hr@sil.org', 'full_time');

set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare n int; p record;
begin
  select * into p from rev_cycle_preview('quarterly', 2029, 1);
  assert p.eligible = 2 and p.not_required = 1 and p.already_open = 0,
    format('contingent worker excluded from preview: %s/%s/%s', p.eligible, p.not_required, p.already_open);
  n := rev_open_cycle('quarterly', 2029, 1);
  assert n = 2, 'opens for full-time staff only, the contingent worker is skipped, got ' || n;
  assert not exists (select 1 from rev_reviews where employee_email = 'frank@sil.org'),
    'contingent worker never gets a review even though they are an active participant';
  raise notice 'I3 ok: contingent workers are excluded from review creation and previews';
end $$;

-- ── H. anon and no-profile callers ──────────────────────────────────────────
set role anon;
do $$ declare e text;
begin
  begin perform rev_is_admin(); exception when others then e := sqlerrm; end;
  assert e like 'permission denied%', 'anon cannot call helpers: ' || coalesce(e, 'no error');
  e := null;
  begin perform count(*) from rev_reviews; exception when others then e := sqlerrm; end;
  raise notice 'H ok: anon blocked (%).', coalesce(e, 'no error but sees 0 rows via RLS');
end $$;
reset role;
select 'ALL TESTS PASSED' as result;
