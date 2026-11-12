#!/usr/bin/env bash
# Account-admin CloudShell setup for the isolated sandbox ONLY. No existing policy or role is edited.
set -euo pipefail
test "$(aws sts get-caller-identity --query Account --output text)" = "481609031197"
ROLE=dandelist-apprunner-sandbox
if aws iam get-user-policy --user-name dandelist-deploy --policy-name DandelistSandboxPassRole >/dev/null 2>&1; then
  echo "Sandbox pass-role policy already exists; inspect it instead of overwriting."
  exit 1
fi
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "Sandbox role already exists; inspect it instead of overwriting."
  exit 1
fi
aws iam create-role --role-name "$ROLE" --tags Key=project,Value=dandelist Key=environment,Value=sandbox \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
aws iam put-role-policy --role-name "$ROLE" --policy-name sandbox-secrets-only --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"arn:aws:secretsmanager:us-east-1:481609031197:secret:dandelist/sandbox/*"}]}'
aws iam put-user-policy --user-name dandelist-deploy --policy-name DandelistSandboxPassRole --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"iam:PassRole","Resource":"arn:aws:iam::481609031197:role/dandelist-apprunner-sandbox"}]}'
echo "Created isolated sandbox instance role and sandbox-only pass-role permission."
