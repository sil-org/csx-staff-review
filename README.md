# CSX Staff Review

Quarterly / annual reviews plus personal goals and monthly check-ins, in the shared GTIS Supabase project
(tables prefixed `rev_`). Stack: React + Vite + Tailwind, Supabase, Resend, Amplify via Terraform
(same as `sil-app-template`). **Status: design + database draft. The React app is not scaffolded yet.**

## What's here
- `design/` rough screen mock-ups (`*.dc.html`, open the published design file for the canvas view).
- `supabase/01_rev_schema.sql` core schema (run first). `supabase/02_rev_departments.sql` departments, heads, launch (run second).
  Both are re-runnable; if you re-run 01, re-run 02 afterwards.
- `supabase/tests/` throwaway-Postgres test scripts: run `stubs.sql`, 01, 02, `seed.sql`, `test.sql`, `test2.sql` in that order
  (expects "ALL TESTS PASSED" and "DEPT TESTS PASSED").
- `terraform/` Amplify hosting, adapted from the finance repo (untested).

## Rules decided so far
- Employee fills out first; **submitting is final (no send-back)**. Manager responds beside each answer in the same form as the
  question type. Employee signs off (agree / disagree + note). Record is then locked and immutable.
- Goals are visible to the employee and direct manager; monthly check-ins live in the goal card; goals can be cancelled (reason required), never deleted.
- Fiscal year starts **October 1**; FY2027 = Oct 2026 - Sep 2027.
- Each person is full-time/part-time and paid/seconded/volunteer. Hours decide which reviews are required
  (default: full-time Q1-Q3 + annual, Q4 when enabled; part-time annual only). Worker type decides which questions apply.
- Departments form a tree with one head each. Heads launch a cycle for their department and everything below; once launched for
  a person nobody can launch it again. Heads read **completed** reviews only for people directly in their department;
  heads higher up see only who has/hasn't submitted. Super admins (a subset of admins) manage departments.

## Open
- Where department structure comes from (profiles table?) and how to import it.
- Edge function to send launch emails (queue is `rev_reminder_log`, kind `launch`; sanitize the HTML there).
- Scaffold the React app from `sil-app-template`.
