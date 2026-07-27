#!/bin/sh
# Render the SeaweedFS S3 identity config from environment variables, then
# exec `weed server` with master + volume + filer + s3 in one process.
#
# The S3 identity here is the SAME one waxlens consumes on the client side
# (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY wherever waxlens runs — on the
# host or in a one-shot container). The stack passes the same values to both
# sides, so the bundled SeaweedFS and the client agree by construction.
#
# `s3.json` is written to a tmpfs-friendly path (/tmp) because
# /etc/seaweedfs is bind-mounted read-only.
set -eu

: "${WAXLENS_S3_ACCESS_KEY_ID:?WAXLENS_S3_ACCESS_KEY_ID is required}"
: "${WAXLENS_S3_SECRET_ACCESS_KEY:?WAXLENS_S3_SECRET_ACCESS_KEY is required}"

S3_CONFIG=/tmp/seaweedfs-s3.json
sed \
  -e "s|__ACCESS_KEY__|${WAXLENS_S3_ACCESS_KEY_ID}|" \
  -e "s|__SECRET_KEY__|${WAXLENS_S3_SECRET_ACCESS_KEY}|" \
  /etc/seaweedfs/s3.template.json > "${S3_CONFIG}"

# Create the bucket once the master answers — runs alongside the server,
# replacing the former one-shot init container (and its ordering problem):
# the retry loop inside init-bucket.sh does all the waiting. Apple Container's
# compose has no `depends_on: condition:`, so nothing outside could sequence a
# separate init container anyway.
/etc/seaweedfs/init-bucket.sh "${WAXLENS_S3_BUCKET:-waxlens}" localhost:9333 &

exec weed server \
  -dir=/data \
  -master.volumeSizeLimitMB=1024 \
  -filer \
  -s3 \
  -s3.config="${S3_CONFIG}"
