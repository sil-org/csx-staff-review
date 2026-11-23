-- Stand-ins for the shared Supabase project's existing objects (copied from License Manager).
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public, auth to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated, anon;

create table profiles (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  primary_email text not null,
  role          text not null default 'member',
  manager_email text,
  employee_type text
);
create table linked_accounts (
  supabase_user_id uuid primary key,
  profile_id       uuid not null references profiles(id),
  email            text not null
);
alter table profiles enable row level security;

create function current_profile_id() returns uuid language sql stable security definer as $$
  select profile_id from linked_accounts where supabase_user_id = auth.uid() limit 1
$$;
create function current_profile_email() returns text language sql stable security definer as $$
  select primary_email from profiles where id = current_profile_id()
$$;
create function require_profile_email() returns text language plpgsql stable security definer set search_path = public as $$
declare v_email text := current_profile_email();
begin
  if v_email is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return v_email;
end;
$$;
create function get_report_emails() returns setof text language sql stable security definer as $$
  with recursive reports as (
    select lower(p.primary_email) as email from profiles p
    where lower(p.manager_email) = lower(current_profile_email())
    union
    select lower(p.primary_email) from profiles p join reports r on lower(p.manager_email) = r.email
  )
  select email from reports
$$;
create policy "profiles: own read" on profiles for select using (id = current_profile_id());
