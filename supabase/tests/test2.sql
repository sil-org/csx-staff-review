\set ON_ERROR_STOP 1
\set hr    '00000000-0000-0000-0000-000000000001'
\set dave  '00000000-0000-0000-0000-000000000002'
\set kate  '00000000-0000-0000-0000-000000000003'
\set bob   '00000000-0000-0000-0000-000000000004'
\set carol '00000000-0000-0000-0000-000000000005'
\set eve   '00000000-0000-0000-0000-000000000006'

-- Clean slate for review rows from the earlier tests (superuser).
reset role;
alter table rev_reviews disable trigger rev_block_locked;
alter table rev_answers disable trigger rev_block_locked;
alter table rev_comments disable trigger rev_block_locked;
alter table rev_signoffs disable trigger rev_block_locked;
delete from rev_signoffs; delete from rev_comments; delete from rev_answers; delete from rev_reviews;
alter table rev_reviews enable trigger rev_block_locked;
alter table rev_answers enable trigger rev_block_locked;
alter table rev_comments enable trigger rev_block_locked;
alter table rev_signoffs enable trigger rev_block_locked;
delete from rev_launches; delete from rev_reminder_log;
update rev_participants set hours = 'full_time', worker_type = 'paid', active = true;
delete from rev_questions where worker_types <> array['paid','seconded','volunteer'];
insert into rev_super_admins (email, added_by) values ('hr@sil.org', 'bootstrap') on conflict do nothing;
-- IT (head dave) > Customer Service (head kate), Operational IT (head eve)
insert into rev_departments (name, parent_id, head_email, source) values ('IT', null, 'dave@sil.org', 'import');
insert into rev_departments (name, parent_id, head_email, source)
  select 'Operational IT', id, 'eve@sil.org', 'import' from rev_departments where name = 'IT';
insert into rev_departments (name, parent_id, head_email, source)
  select 'Customer Service', id, 'kate@sil.org', 'import' from rev_departments where name = 'Operational IT';
update rev_participants set department_id = (select id from rev_departments where name = 'Customer Service') where email in ('bob@sil.org','carol@sil.org');
update rev_participants set department_id = (select id from rev_departments where name = 'Operational IT') where email = 'eve@sil.org';
create table dept_ids as select name, id from rev_departments;
grant select on dept_ids to authenticated;

-- ── J. who may manage departments ──
set role authenticated;
set request.jwt.claim.sub = :'kate';
do $$ declare e text;
begin
  begin insert into rev_departments (name) values ('Rogue'); exception when others then e := sqlerrm; end;
  assert e is not null, 'a head cannot create departments';
  e := null;
  begin update rev_participants set department_id = null where email = 'bob@sil.org'; exception when others then e := sqlerrm; end;
  raise notice 'J1 ok: only super admins change the structure';
end $$;
reset role;
do $$ begin assert (select department_id from rev_participants where email='bob@sil.org') is not null, 'bob still in his department'; end $$;
set role authenticated;
set request.jwt.claim.sub = :'hr';
-- plain admin (not super) cannot assign departments
do $$ declare e text; begin
  begin update rev_participants set department_id = null where email = 'bob@sil.org'; exception when others then e := sqlerrm; end;
  raise notice 'J1b super admin can reassign: %', coalesce(e, 'ok');
end $$;
reset role;
update rev_participants set department_id = (select id from rev_departments where name = 'Customer Service') where email = 'bob@sil.org';
-- a plain admin (not super) is refused
insert into rev_admins (email, added_by) values ('dave@sil.org', 'bootstrap') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = :'dave';
do $$ declare e text; begin
  begin update rev_participants set department_id = null where email = 'bob@sil.org'; exception when others then e := sqlerrm; end;
  assert e like 'Only a super admin%', 'plain admin refused: ' || coalesce(e, 'no error');
  raise notice 'J1c ok: plain admins cannot assign departments';
end $$;
reset role;
delete from rev_admins where email = 'dave@sil.org';
set role authenticated;
set request.jwt.claim.sub = :'hr';
do $$ declare e text;
begin
  insert into rev_departments (name, parent_id) values ('Temp', (select id from dept_ids where name='Customer Service'));
  begin
    update rev_departments set parent_id = (select id from rev_departments where name='Temp') where name = 'Customer Service';
  exception when others then e := sqlerrm; end;
  assert e like 'That move would put%', 'cycle blocked: ' || coalesce(e, 'no error');
  delete from rev_departments where name = 'Temp';
  raise notice 'J2 ok: super admin edits, cycles blocked';
end $$;

-- ── K. launching ──
set role authenticated;
set request.jwt.claim.sub = :'bob';
do $$ declare e text;
begin
  begin perform * from rev_launch_preview((select id from dept_ids where name='IT'), 'quarterly', 2026, 1); exception when others then e := sqlerrm; end;
  assert e like 'only the head%', 'employee cannot preview: ' || coalesce(e,'no error');
end $$;
-- Kate heads Customer Service, which sits BELOW Operational IT: she cannot launch for Operational IT.
set request.jwt.claim.sub = :'kate';
do $$ declare e text;
begin
  begin perform rev_launch_cycle((select id from dept_ids where name='Operational IT'), 'quarterly', 2026, 1, 's', '<p>x</p>'); exception when others then e := sqlerrm; end;
  assert e like 'only the head%', 'a lower head cannot launch for a department above: ' || coalesce(e,'no error');
  raise notice 'K0 ok: heads launch only for their own department and below';
end $$;
-- Eve (Operational IT) launches for her department and everything below it (Customer Service too).
set request.jwt.claim.sub = :'eve';
do $$ declare e text; n int; p record; ops uuid := (select id from dept_ids where name='Operational IT');
begin
  select * into p from rev_launch_preview(ops, 'quarterly', 2026, 1);
  assert p.eligible = 3 and p.already_open = 0 and jsonb_array_length(p.prior_launches) = 0, 'eve preview: ' || p::text;
  begin perform rev_launch_cycle(ops, 'quarterly', 2026, 1, 'Hi', '<p onclick="x()">bad</p>'); exception when others then e := sqlerrm; end;
  assert e like '%not allowed%', 'unsafe html refused: ' || coalesce(e,'no error');
  n := rev_launch_cycle(ops, 'quarterly', 2026, 1, 'Your Q1 review', '<p>Hello <a href="https://x.example">link</a></p>');
  assert n = 3, 'eve launched 3 (her team + Customer Service), got ' || n;
  raise notice 'K1 ok: a head launches her department and everything below it';
end $$;
reset role;
do $$ begin
  assert (select count(*) from rev_reminder_log where kind='launch') = 3, 'three emails queued';
  raise notice 'K2 ok: one email queued per person';
end $$;
-- Once launched, nobody else can launch for those people, higher or lower.
set role authenticated;
set request.jwt.claim.sub = :'kate';
do $$ declare e text; p record; cs uuid := (select id from dept_ids where name='Customer Service');
begin
  select * into p from rev_launch_preview(cs, 'quarterly', 2026, 1);
  assert p.eligible = 0 and p.already_open = 2 and p.prior_launches->0->>'launched_by' = 'eve@sil.org', 'kate sees it is already launched: ' || p::text;
  begin perform rev_launch_cycle(cs, 'quarterly', 2026, 1, 's', '<p>x</p>'); exception when others then e := sqlerrm; end;
  assert e like 'Nothing to send%', 'kate cannot launch again: ' || coalesce(e,'no error');
  raise notice 'K3 ok: already launched, a lower head cannot launch again';
end $$;
set request.jwt.claim.sub = :'dave';
do $$ declare e text; it uuid := (select id from dept_ids where name='IT');
begin
  begin perform rev_launch_cycle(it, 'quarterly', 2026, 1, 's', '<p>x</p>'); exception when others then e := sqlerrm; end;
  assert e like 'Nothing to send%', 'a higher head cannot launch for people already launched: ' || coalesce(e,'no error');
  raise notice 'K4 ok: a higher head cannot launch again either';
end $$;

-- ── L. read-only access: only the head directly over the person ──
do $$ begin
  assert (select count(*) from rev_reviews) = 0, 'higher head cannot read unlocked reviews';
end $$;
reset role;
alter table rev_reviews disable trigger rev_block_locked;
update rev_reviews set status = 'locked', submitted_at = now(), locked_at = now() where employee_email = 'bob@sil.org';
alter table rev_reviews enable trigger rev_block_locked;
set role authenticated;
set request.jwt.claim.sub = :'kate';
do $$ begin
  assert (select count(*) from rev_reviews where employee_email='bob@sil.org') = 1, 'the head over bob reads his locked review';
  assert (select count(*) from rev_reviews where employee_email='carol@sil.org') = 0, 'but not carol''s unlocked one';
  begin update rev_reviews set status = 'draft' where employee_email = 'bob@sil.org'; exception when others then null; end;
  raise notice 'L1 ok: head reads locked reviews of her own people';
end $$;
set request.jwt.claim.sub = :'eve';
do $$ begin
  assert (select count(*) from rev_reviews where employee_email = 'bob@sil.org') = 0, 'head two levels up cannot read bob';
  raise notice 'L2 ok: upper heads cannot read reviews below the next level';
end $$;
set request.jwt.claim.sub = :'dave';
do $$ begin
  assert (select count(*) from rev_reviews) = 0, 'top head reads none';
  assert (select status from rev_department_status((select id from dept_ids where name='IT'), 'quarterly', 2026, 1) where employee_email='bob@sil.org') = 'locked', 'but sees bob is done';
  assert (select status from rev_department_status((select id from dept_ids where name='IT'), 'quarterly', 2026, 1) where employee_email='carol@sil.org') = 'draft', 'and carol has not submitted';
  raise notice 'L3 ok: upper heads see who has submitted, status only';
end $$;
reset role;
do $$ begin
  assert (select status from rev_reviews where employee_email='bob@sil.org') = 'locked';
end $$;

-- ── M. roll-up report ──
set role authenticated;
set request.jwt.claim.sub = :'dave';
do $$ declare r record;
begin
  select * into r from rev_department_report((select id from dept_ids where name='IT'), 'quarterly', 2026, 1) where name = 'IT';
  assert r.people = 3 and r.locked = 1 and r.drafts = 2, 'IT rolls up: ' || r::text;
  select * into r from rev_department_report((select id from dept_ids where name='IT'), 'quarterly', 2026, 1) where name = 'Customer Service';
  assert r.people = 2 and r.locked = 1 and r.drafts = 1 and r.depth = 2, 'CS row: ' || r::text;
  raise notice 'M ok: report rolls up through the tree';
end $$;
reset role;
select 'DEPT TESTS PASSED' as result;
