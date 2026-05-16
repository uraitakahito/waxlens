#!/bin/bash
# Bootstrap the local development environment.
#
# Writes a `.env` file consumed by `compose.dev.yaml` (USER_ID / GROUP_ID
# control the in-container `node` user's uid/gid so bind-mounted /app is
# host-writable; TZ is forwarded to the container's TZ env). browserhive
# 系のような submodule clone は不要 — waxlens は chromium-server /
# browserhive を含まない独立 stack。
set -e

echo "Starting waxlens setup..."

cat > .env << EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=Asia/Tokyo
EOF
echo "Created .env file"

echo ""
echo "Setup complete!"
echo ""
echo "Dev stack:"
echo "  docker compose -f compose.dev.yaml up -d --build"
echo "  docker compose -f compose.dev.yaml exec waxlens bash"
echo "  # inside the container:"
echo "  pnpm install && pnpm --filter @waxlens/core build"
echo "  aws --endpoint-url http://seaweedfs:8333 s3 cp samples/wikipedia.wacz s3://waxlens/wikipedia.wacz"
echo "  ./packages/core/dist/cli.js s3://waxlens/wikipedia.wacz"
echo ""
echo "Prod stack (one-shot validation):"
echo "  docker compose -f compose.prod.yaml up -d"
echo "  # upload from a sidecar AWS CLI in the same network:"
echo "  docker run --rm --network waxlens-network \\"
echo "    -v \$(pwd)/samples:/samples:ro \\"
echo "    -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \\"
echo "    -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs:8333 \\"
echo "    amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz"
echo "  docker compose -f compose.prod.yaml --profile run run --rm waxlens s3://waxlens/wikipedia.wacz"
echo "  docker compose -f compose.prod.yaml down"
