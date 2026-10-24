# Staging stack (T6.5): managed PostgreSQL with PostGIS + TimescaleDB, Redis, object storage, Kubernetes, secrets manager.
# Provider is AWS; swap the module internals for another cloud without changing this file's interface.
# NOT applied or `terraform plan`-verified in this repository's development environment (no cloud credentials, no
# Terraform install): run `terraform init && terraform plan -var-file=envs/staging/staging.tfvars` and fix any drift.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
}

module "database" {
  source         = "./modules/database"
  name           = "vayu-${var.env}"
  instance_class = var.db_instance_class
  subnet_ids     = var.private_subnet_ids
  vpc_id         = var.vpc_id
  # PostGIS is a standard RDS extension; TimescaleDB is not on RDS, so staging uses Timescale Cloud or a self-managed
  # instance via var.timescale_endpoint when set. See docs/runbook.md "Database".
  timescale_endpoint = var.timescale_endpoint
}

module "redis" {
  source     = "./modules/redis"
  name       = "vayu-${var.env}"
  subnet_ids = var.private_subnet_ids
  vpc_id     = var.vpc_id
}

module "object_storage" {
  source = "./modules/object_storage"
  name   = "vayu-${var.env}-raw"
}

module "kubernetes" {
  source     = "./modules/kubernetes"
  name       = "vayu-${var.env}"
  subnet_ids = var.private_subnet_ids
}

module "secrets" {
  source = "./modules/secrets"
  name   = "vayu/${var.env}"
  secret_names = ["jwt-secret", "database-url", "redis-url", "twilio-auth-token", "exotel-api-token", "bhashini-key", "data-gov-in-key"]
}
