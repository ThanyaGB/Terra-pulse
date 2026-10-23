variable "name" { type = string }
variable "instance_class" { type = string }
variable "subnet_ids" { type = list(string) }
variable "vpc_id" { type = string }
variable "timescale_endpoint" { type = string }

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name   = "${var.name}-db"
  vpc_id = var.vpc_id
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "this" {
  identifier              = var.name
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.instance_class
  allocated_storage       = 100
  storage_encrypted       = true # AES-256 at rest (spec section 10)
  db_name                 = "vayu"
  username                = "vayu"
  password                = random_password.db.result
  db_subnet_group_name    = aws_db_subnet_group.this.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  backup_retention_period = 7
  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${var.name}-final"
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "password" {
  value     = random_password.db.result
  sensitive = true
}
