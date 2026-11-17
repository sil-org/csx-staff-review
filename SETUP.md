# Setup Guide

One-time setup in external dashboards before this app can go live. Do them in order.

Replace `YOUR_APP_NAME` below with your project's name (e.g. `license-manager`) and `YOUR_DOMAIN` with the subdomain you'll host it at (e.g. `licenses.sil.org`).

## 1. Create a Supabase project

- Go to supabase.com and sign in
- New project → Name: `YOUR_APP_NAME` → pick a region
- Wait for it to provision
- Project Settings > API → copy **Project URL** (`VITE_SUPABASE_URL`) and **anon public key** (`VITE_SUPABASE_ANON_KEY`)
- Run the database schema
  - SQL Editor > New query, paste the contents of `supabase/schema.sql`, run it
  - Add your app-specific tables in a new file/query — reference `profiles(id)` as the identity source of truth, not `auth.users`

## 2. Set up Google OAuth, restricted to SIL staff

This is the one step where you make a real decision: how strictly should this be limited to sil.org accounts?

**Option A — enforce at the Google Cloud OAuth consent screen** (recommended if everyone has a Workspace account)

- console.cloud.google.com → new project `YOUR_APP_NAME`
- APIs & Services > OAuth consent screen
  - User type: **Internal** (only available if this Google Cloud project lives inside the sil.org Workspace org — this makes Google itself reject any non-sil.org sign-in, no app code needed)
- APIs & Services > Credentials > Create Credentials > OAuth client ID
  - Application type: Web application
  - Authorised JavaScript origins: `https://YOUR_DOMAIN`
  - Authorised redirect URIs: `https://your-project-id.supabase.co/auth/v1/callback`
  - Copy Client ID and Client Secret

**Option B — External consent screen + enforce in the database**

If Internal isn't available to you, use External, then uncomment the domain check inside the `resolve_profile()` function in `supabase/schema.sql` (rejects any non-@sil.org email at profile-creation time). Treat this as required, not optional, if you go this route — a client-side check alone can be bypassed.

In Supabase:

- Authentication > Providers > Google → enable, paste Client ID/Secret
- Authentication > URL Configuration:
  - Site URL: `https://YOUR_DOMAIN`
  - Redirect URLs: `https://YOUR_DOMAIN/auth/callback`, plus `http://localhost:5173/auth/callback` for local dev

## 3. Create the Amplify Hosting app

Frontend hosting is AWS Amplify Hosting, connected directly to this GitHub repo — no manual S3 bucket, CloudFront distribution, or Route 53 record to create. Amplify builds on every push to `main` using `amplify.yml` at the repo root.

- AWS Console > **Amplify** > **Create new app** > **Host a web app**
- Choose **GitHub** as the source, authorize access, and select this repo + the `main` branch
- Amplify auto-detects `amplify.yml`; leave build settings as-is
- App settings > **Environment variables** — add:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Save and deploy — Amplify runs the first build automatically

**Custom domain**

- App > **Custom domains** > **Add domain** → enter the root domain (e.g. `sil.org`) and the subdomain (`YOUR_DOMAIN`)
- If the domain's hosted zone already lives in the same AWS account's Route 53, Amplify can create/verify the DNS records automatically
- If Route 53 for sil.org is managed elsewhere or in a different account, Amplify will show a CNAME (and an ACM validation CNAME) to add manually wherever that zone is hosted
- Amplify provisions and renews the SSL certificate for you

## 4. Add GitHub Secrets

Settings > Secrets and variables > Actions — only Supabase-related secrets are needed now (Amplify handles its own frontend build/deploy and its own env vars, set in the Amplify Console in step 3):

| Secret name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | From Supabase account settings |
| `SUPABASE_PROJECT_REF` | Supabase Project Settings > General > Reference ID |

If you're not using Edge Functions yet, delete the `deploy-edge-functions` job from `.github/workflows/deploy.yml` (and skip the two secrets above) — otherwise the GitHub Actions workflow now only handles Edge Functions; the frontend is fully owned by Amplify.

## 5. Wire up the feedback widget (optional)

`src/pages/Dashboard.jsx` renders a floating feedback button (`src/components/FeedbackWidget.jsx`) by default — bottom-right, 1-5 smiley rating + free-text comment, emailed via Resend. To make it actually send:

- Sign up at resend.com, verify a sending domain, get an API key
- `npx supabase secrets set RESEND_API_KEY=re_xxxxx`
- `npx supabase secrets set RESEND_FROM="YOUR_APP_NAME <noreply@YOUR_VERIFIED_DOMAIN>"`
- `email_log` table is already created by `supabase/schema.sql` (step 1)
- Deploy the function: `npx supabase functions deploy send-email` (or let the GitHub Action in step 4 do it on push)

Not using it? Delete `src/components/FeedbackWidget.jsx`, its usage in `Dashboard.jsx`, `src/lib/email.js`, and `supabase/functions/send-email`.

## 6. Push and deploy

```
git push -u origin main
```

Amplify picks up the push and builds/deploys the frontend automatically. The GitHub Action (if kept) deploys Edge Functions on the same push.

## 7. Local development

```
cp .env.example .env
# fill in .env with your Supabase URL and anon key
npm install
npm run dev
# open http://localhost:5173
```

## 8. Make yourself admin

After your first sign-in:

```sql
update profiles set role = 'admin'
where primary_email = 'your-email@sil.org';
```
