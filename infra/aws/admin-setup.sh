#!/usr/bin/env bash
# Run once in AWS CloudShell, signed in as an account admin, with deploy-policy.json beside this file.
# Creates the four roles Dandelist's deploy user may hand to AWS services but can never create or edit,
# and applies the deploy user's policy as a new default version. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
ACCT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="dandelist-media-$ACCT"

role() { # name, service principal
  if ! aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam create-role --role-name "$1" --tags Key=project,Value=dandelist \
      --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
    echo "created role $1"
  fi
}

# App Runner pulls the image from ECR with this one.
role dandelist-apprunner-ecr build.apprunner.amazonaws.com
aws iam attach-role-policy --role-name dandelist-apprunner-ecr --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# The running API: reads its own secrets and the media bucket, nothing else.
role dandelist-apprunner-instance tasks.apprunner.amazonaws.com
aws iam put-role-policy --role-name dandelist-apprunner-instance --policy-name dandelist-runtime --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": \"secretsmanager:GetSecretValue\", \"Resource\": \"arn:aws:secretsmanager:us-east-1:$ACCT:secret:dandelist/*\" },
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\" },
    { \"Effect\": \"Allow\", \"Action\": \"s3:ListBucket\", \"Resource\": \"arn:aws:s3:::$BUCKET\" }
  ]
}"

# CodeBuild builds the image from the public repo and pushes it to the one ECR repository.
role dandelist-codebuild codebuild.amazonaws.com
aws iam put-role-policy --role-name dandelist-codebuild --policy-name dandelist-image-build --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"], \"Resource\": \"arn:aws:logs:us-east-1:$ACCT:log-group:/aws/codebuild/dandelist-*\" },
    { \"Effect\": \"Allow\", \"Action\": \"ecr:GetAuthorizationToken\", \"Resource\": \"*\" },
    { \"Effect\": \"Allow\", \"Action\": [\"ecr:BatchCheckLayerAvailability\", \"ecr:BatchGetImage\", \"ecr:GetDownloadUrlForLayer\", \"ecr:InitiateLayerUpload\", \"ecr:UploadLayerPart\", \"ecr:CompleteLayerUpload\", \"ecr:PutImage\"], \"Resource\": \"arn:aws:ecr:us-east-1:$ACCT:repository/dandelist-api\" }
  ]
}"

# iPhone builds on CodeBuild's Mac: logs, and the one signing secret (certificate, profile, App Store Connect key).
role dandelist-ios-build codebuild.amazonaws.com
aws iam put-role-policy --role-name dandelist-ios-build --policy-name dandelist-ios-build --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"], \"Resource\": \"arn:aws:logs:us-east-1:$ACCT:log-group:/aws/codebuild/dandelist-*\" },
    { \"Effect\": \"Allow\", \"Action\": \"secretsmanager:GetSecretValue\", \"Resource\": \"arn:aws:secretsmanager:us-east-1:$ACCT:secret:dandelist-ios/*\" }
  ]
}"

# The deploy user's own permissions. IAM keeps five versions; drop the oldest spare one first.
POLICY="arn:aws:iam::$ACCT:policy/DandelistDeploy"
sed "s/ACCOUNT_ID/$ACCT/g" deploy-policy.json > /tmp/dandelist-deploy-policy.json
if [ "$(aws iam list-policy-versions --policy-arn "$POLICY" --query 'length(Versions)' --output text)" -ge 5 ]; then
  OLDEST=$(aws iam list-policy-versions --policy-arn "$POLICY" --query 'sort_by(Versions[?IsDefaultVersion==`false`], &CreateDate)[0].VersionId' --output text)
  aws iam delete-policy-version --policy-arn "$POLICY" --version-id "$OLDEST"
fi
aws iam create-policy-version --policy-arn "$POLICY" --policy-document file:///tmp/dandelist-deploy-policy.json --set-as-default --query 'PolicyVersion.VersionId' --output text
echo "done: roles ready and deploy policy updated"
