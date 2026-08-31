#!/usr/bin/env bash
# Deploys this static sandbox (map-sandbox/) to S3 + CloudFront.
# Idempotent -- safe to re-run after editing files, or if a previous run
# only got partway through. Re-running just syncs files and invalidates
# the CloudFront cache; the bucket/OAC/distribution are only created
# once (their ids are cached in .cloudfront-distribution-id, which is
# NOT synced to the bucket).
#
# CloudFront + Origin Access Control (OAC) in front of a PRIVATE bucket,
# not a public S3 website endpoint -- the earlier plain-HTTP website-
# endpoint version broke for at least one real viewer: browsers
# increasingly force/prefer https and S3 website endpoints have no TLS
# listener at all, so an https-upgrade attempt just fails outright. OAC
# is the current AWS-recommended pattern (the older Origin Access
# Identity is legacy) -- the bucket grants s3:GetObject ONLY to this
# specific CloudFront distribution's service principal, with full
# public-access-block re-enabled, so there is no longer a second,
# unlocked, plain-HTTP way to reach these files at all. Share the
# https://*.cloudfront.net URL this script prints, not the old
# s3-website-*.amazonaws.com one -- that one now 403s by design.
#
# A first-time distribution create takes several minutes to fully
# propagate globally; this script doesn't block waiting for that.

set -euo pipefail

BUCKET_NAME="worship-map-sandbox-523757310696"
REGION="ap-southeast-2"
OAC_NAME="worship-map-sandbox-oac"
# AWS-managed "CachingOptimized" policy -- a fixed, documented id, not
# something this account created (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html).
CACHING_OPTIMIZED_POLICY_ID="658327ea-f89d-4fab-a63d-7e88639e58f6"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_ID_FILE="${SCRIPT_DIR}/.cloudfront-distribution-id"
ORIGIN_DOMAIN="${BUCKET_NAME}.s3.${REGION}.amazonaws.com"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

echo "==> Bucket: s3://${BUCKET_NAME} (${REGION})"

if aws s3api head-bucket --bucket "$BUCKET_NAME" --region "$REGION" 2>/dev/null; then
  echo "==> Bucket already exists, reusing it"
else
  echo "==> Creating bucket"
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
fi

echo "==> Re-blocking all public access (CloudFront/OAC reaches the bucket via a signed service-principal policy, not public access)"
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Dead config now that the bucket is private -- CloudFront's own
# DefaultRootObject (set below) replaces what this used to do.
aws s3api delete-bucket-website --bucket "$BUCKET_NAME" 2>/dev/null || true

echo "==> Finding or creating the Origin Access Control"
OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id | [0]" \
  --output text)"
if [ -z "$OAC_ID" ] || [ "$OAC_ID" = "None" ]; then
  OAC_ID="$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{
      \"Name\": \"${OAC_NAME}\",
      \"SigningProtocol\": \"sigv4\",
      \"SigningBehavior\": \"always\",
      \"OriginAccessControlOriginType\": \"s3\"
    }" \
    --query "OriginAccessControl.Id" --output text)"
  echo "==> Created OAC ${OAC_ID}"
else
  echo "==> Reusing OAC ${OAC_ID}"
fi

if [ -f "$DIST_ID_FILE" ] && aws cloudfront get-distribution --id "$(cat "$DIST_ID_FILE")" >/dev/null 2>&1; then
  DIST_ID="$(cat "$DIST_ID_FILE")"
  echo "==> Reusing existing CloudFront distribution ${DIST_ID}"
else
  echo "==> Creating CloudFront distribution (first-time propagation can take several minutes)"
  DIST_CONFIG="$(mktemp)"
  trap 'rm -f "$DIST_CONFIG"' EXIT
  cat > "$DIST_CONFIG" <<EOF
{
  "CallerReference": "worship-map-sandbox-$(date +%s)",
  "Comment": "worship-map-sandbox",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "PriceClass": "PriceClass_100",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "s3-origin",
        "DomainName": "${ORIGIN_DOMAIN}",
        "OriginAccessControlId": "${OAC_ID}",
        "S3OriginConfig": { "OriginAccessIdentity": "" }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET", "HEAD"] },
    "CachePolicyId": "${CACHING_OPTIMIZED_POLICY_ID}"
  }
}
EOF
  DIST_ID="$(aws cloudfront create-distribution --distribution-config "file://${DIST_CONFIG}" --query "Distribution.Id" --output text)"
  echo "$DIST_ID" > "$DIST_ID_FILE"
  echo "==> Created distribution ${DIST_ID}"
fi

DIST_DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query "Distribution.DomainName" --output text)"

echo "==> Locking the bucket to this distribution only"
aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*",
      "Condition": {
        "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DIST_ID}" }
      }
    }
  ]
}
EOF
)"

echo "==> Syncing files"
aws s3 sync "$SCRIPT_DIR" "s3://${BUCKET_NAME}/" \
  --delete \
  --exclude "*.test.js" \
  --exclude "*.log" \
  --exclude "deploy-aws.sh" \
  --exclude "package.json" \
  --exclude "no_cache_server.py" \
  --exclude ".cloudfront-distribution-id"

echo "==> Invalidating the CloudFront cache so this sync is visible immediately"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

echo ""
echo "==> Deployed: https://${DIST_DOMAIN}/"
echo "    (first-time distribution creation can take several minutes to finish propagating -- a 403/504 right after creation usually just means it isn't live globally yet)"
