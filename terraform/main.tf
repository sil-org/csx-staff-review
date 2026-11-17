# Amplify Hosting app + env vars + custom domain for the review platform.
# Everything else (the shared Supabase project, SSO provider, Resend, Edge
# Functions, pg_cron reminder jobs, GitHub Actions secrets) stays a manual/CLI
# step -- see supabase/01_rev_schema.sql and SETUP.md. The Supabase project is
# shared with License Manager, Helpdesk and the contract repository, so
# nothing here creates or changes it.

resource "aws_amplify_app" "reviews" {
  name         = "csx-staff-review"
  repository   = "https://github.com/${var.github_repo}"
  access_token = var.github_access_token

  # amplify.yml at the repo root is auto-detected by Amplify on every build --
  # no build_spec needed here.

  environment_variables = {
    VITE_SUPABASE_URL      = var.supabase_url
    VITE_SUPABASE_ANON_KEY = var.supabase_anon_key
    VITE_SSO_PROVIDER_ID   = var.sso_provider_id
  }

  # SPA fallback: react-router-dom handles client-side routing, so any
  # non-file path (no dot in the last segment) must still serve index.html
  # with a 200, not Amplify's default behavior of a raw 404 for unknown
  # paths. This is a rewrite, not a redirect, so the URL in the browser
  # (e.g. /auth/callback) stays intact.
  custom_rule {
    source = "</^[^.]+$/>"
    target = "/index.html"
    status = "200"
  }
}

resource "aws_amplify_branch" "main" {
  app_id            = aws_amplify_app.reviews.id
  branch_name       = "main"
  enable_auto_build = true
}

resource "aws_amplify_domain_association" "reviews" {
  app_id      = aws_amplify_app.reviews.id
  domain_name = var.domain_name

  sub_domain {
    branch_name = aws_amplify_branch.main.branch_name
    prefix      = var.subdomain
  }

  # If domain_name's hosted zone isn't in this AWS account, Amplify can't
  # auto-verify/issue the cert -- `terraform apply` will then wait on DNS
  # records this account doesn't control. Check
  # `certificate_verification_dns_record` / `sub_domain[0].verified` in the
  # state/plan output and hand the CNAMEs to whoever owns that zone.
}
