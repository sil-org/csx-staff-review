output "amplify_app_id" {
  value = aws_amplify_app.reviews.id
}

output "amplify_default_domain" {
  value = "main.${aws_amplify_app.reviews.default_domain}"
}

output "amplify_custom_domain" {
  value = "${var.subdomain}.${var.domain_name}"
}
