variable "env" {
  type    = string
  default = "staging"
}
variable "region" {
  type    = string
  default = "ap-south-1"
}
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_instance_class" {
  type    = string
  default = "db.t4g.large"
}
variable "timescale_endpoint" {
  type    = string
  default = ""
}
