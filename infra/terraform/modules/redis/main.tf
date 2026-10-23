variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "vpc_id" { type = string }

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "Vayu-Swachh event bus (Redis Streams), shared state and rate limits"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true # TLS in transit
}

output "endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
