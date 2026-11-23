# CSX Staff Review: developer context for Claude

Quarterly/annual reviews plus goals and monthly check-ins. React + Vite + Tailwind, Supabase (shared GTIS project,
tables prefixed `rev_`), Resend, Amplify via Terraform. Started from `sil-app-template`. `README.md` has the decisions
and how to run it; read it first.

## Layout
- `design/`: rough mock-ups (`*.dc.html`), the spec for each page. Pages in `src/pages` are stubs that name their design file.
- `supabase/01_rev_schema.sql`, `02_rev_departments.sql`: run by hand in the SQL Editor, in order; re-runnable (re-run 02 after 01).
  Business rules live in Postgres RPCs and RLS, not the frontend. Drop old overloads when an RPC signature changes.
- `supabase/tests/`: throwaway-Postgres scripts (stubs, 01, 02, seed, test, test2); expect "ALL TESTS PASSED" and "DEPT TESTS PASSED".
- `src/lib/rev.js`: thin wrappers over the RPCs. `src/context/RevContext.jsx`: admin / super admin / headed departments (display only).

## Rules to preserve
- Submitting a review is final: no send-back. Locked reviews are immutable (triggers).
- Goals are cancelled, never deleted; a reason is optional. Fiscal year starts October 1 (FY2027 = Oct 2026 - Sep 2027).
- Hours (full/part-time, set on `rev_participants`, decides required reviews) vs. worker type (paid/seconded/volunteer, decides which
  questions apply): worker type is NEVER stored or hand-edited — `rev_worker_type()` derives it live from `profiles.employee_type`
  (`employee`->paid, `member`->seconded ("Supported" in the UI), `volunteer`->volunteer; anything else, including null, -> no
  questions match rather than guessing one).
- Departments are a tree with one head. Heads launch for their department and below; a review can only be launched once per person.
  Heads read COMPLETED reviews only for people directly in their department; higher heads see status only.
- Contingent workers (`profiles.employee_type = 'contingent'`) never get reviews, even if they're an active participant —
  excluded in `rev_cycle_preview`, `rev_create_reviews` (shared by `rev_open_cycle`/`rev_launch_cycle`), and `rev_launch_preview`.

## Open
- Where the department structure comes from (profiles has `manager_email` and `employee_type`, no department field); import plan.
- Edge function to send launch emails (queue: `rev_reminder_log`, kind `launch`; sanitize HTML there).
- Port the screens from `design/` into the stub pages.
- Real sign-in needs the shared Supabase `.env` (1Password "license manager" vault).
