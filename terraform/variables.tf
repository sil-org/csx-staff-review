variable "aws_region" {
  description = "AWS region to create the Amplify app in."
  type        = string
  default     = "us-east-1"
}

variable "github_repo" {
  description = "owner/repo on GitHub that Amplify builds from."
  type        = string
  default     = "sil-org/csx-staff-review"
}

variable "github_access_token" {
  description = <<-EOT
    A GitHub personal access token (repo scope) Amplify uses to read the
    repo and register webhooks. Only required the first time Terraform
    creates the aws_amplify_app resource with a repository attached -- the
    "Authorize AWS Amplify" GitHub App flow done from the Console can't be
    driven by Terraform, so this PAT is the Terraform-manageable equivalent.
  EOT
  type        = string
  sensitive   = true
}

variable "domain_name" {
  description = "Root domain whose hosted zone this app's subdomain is added to, e.g. sil.org."
  type        = string
  default     = "sil.org"
}

variable "subdomain" {
  description = "Subdomain prefix the main branch is served from, e.g. reviews."
  type        = string
  default     = "reviews"
}

variable "supabase_url" {
  description = "VITE_SUPABASE_URL -- the SHARED GTIS Supabase project's API URL (same one License Manager, Helpdesk and the contract repository use)."
  type        = string
}

variable "supabase_anon_key" {
  description = "VITE_SUPABASE_ANON_KEY -- the shared GTIS project's anon/public key."
  type        = string
  sensitive   = true
}

variable "sso_provider_id" {
  description = <<-EOT
    VITE_SSO_PROVIDER_ID -- the UUID of the SAML IdP already registered in the
    shared GTIS Supabase project (Authentication > SSO), if the shared project
    signs in through the SIL IdP like License Manager's .env does. Fetch it
    with `npx supabase sso list --project-ref <ref>`. Leave as an empty string
    if the app signs in with Google OAuth instead.
  EOT
  type        = string
  default     = ""
}
