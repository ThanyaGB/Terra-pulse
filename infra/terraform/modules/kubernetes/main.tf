variable "name" { type = string }
variable "subnet_ids" { type = list(string) }

resource "aws_iam_role" "cluster" {
  name = "${var.name}-eks"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "eks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  name     = var.name
  role_arn = aws_iam_role.cluster.arn
  vpc_config { subnet_ids = var.subnet_ids }
  encryption_config {
    resources = ["secrets"]
    provider { key_arn = aws_kms_key.secrets.arn }
  }
  depends_on = [aws_iam_role_policy_attachment.cluster]
}

resource "aws_kms_key" "secrets" {
  description         = "${var.name} Kubernetes secrets"
  enable_key_rotation = true
}

output "cluster_name" { value = aws_eks_cluster.this.name }
