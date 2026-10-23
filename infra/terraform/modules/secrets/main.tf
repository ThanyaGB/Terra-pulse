variable "name" { type = string }
variable "secret_names" { type = list(string) }

resource "aws_kms_key" "secrets" {
  description         = "Vayu-Swachh secrets (${var.name})"
  enable_key_rotation = true
}

# Containers only; values are set out-of-band by the secret owners and are never in Terraform state or this repo.
resource "aws_secretsmanager_secret" "this" {
  for_each   = toset(var.secret_names)
  name       = "${var.name}/${each.key}"
  kms_key_id = aws_kms_key.secrets.arn
}

output "arns" { value = { for k, s in aws_secretsmanager_secret.this : k => s.arn } }
