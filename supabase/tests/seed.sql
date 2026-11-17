-- people: dave (top) > kate, eve ; kate > bob ; bob > carol ; hr is a separate admin under dave
insert into profiles (display_name, primary_email, manager_email) values
  ('Dave',  'dave@sil.org',  null),
  ('Kate',  'kate@sil.org',  'dave@sil.org'),
  ('Eve',   'eve@sil.org',   'dave@sil.org'),
  ('Bob',   'bob@sil.org',   'kate@sil.org'),
  ('Carol', 'carol@sil.org', 'bob@sil.org'),
  ('HR',    'hr@sil.org',    'dave@sil.org');

insert into linked_accounts (supabase_user_id, profile_id, email)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, p.id, p.primary_email
from (values (1,'hr@sil.org'),(2,'dave@sil.org'),(3,'kate@sil.org'),(4,'bob@sil.org'),(5,'carol@sil.org'),(6,'eve@sil.org')) v(n, e)
join profiles p on p.primary_email = v.e;

insert into rev_admins (email, added_by) values ('hr@sil.org', 'bootstrap');

with t as (
  insert into rev_templates (kind, name, is_active, created_by) values
    ('quarterly', 'Quarterly', true, 'hr@sil.org'),
    ('annual',    'Annual',    true, 'hr@sil.org')
  returning id, kind
)
insert into rev_questions (template_id, position, prompt, type, options, required)
select t.id, q.position, q.prompt, q.type, q.options, q.required
from t
join (values
  ('quarterly', 1, 'What went well?',     'paragraph',  null::jsonb,                           true),
  ('quarterly', 2, 'Overall rating',      'select',     '["Exceeds","Meets","Below"]'::jsonb,  true),
  ('quarterly', 3, 'Anything else?',      'short_text', null::jsonb,                           false),
  ('annual',    1, 'Year in review',      'paragraph',  null::jsonb,                           true)
) q(kind, position, prompt, type, options, required) on q.kind = t.kind;

insert into rev_participants (email, added_by) values
  ('bob@sil.org', 'hr@sil.org'), ('carol@sil.org', 'hr@sil.org'), ('eve@sil.org', 'hr@sil.org');
