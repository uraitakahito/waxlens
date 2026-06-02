#!/usr/bin/env bash
# Frictionless Data Package v1 公式スキーマ(JSON Schema draft-04)を取得して vendoring する。
# WACZ 1.1.1 は profile: "data-package"(Frictionless v1)を使うため v1 スキーマを当てる。
#
# 使い方: packages/core で `bash scripts/update-frictionless-schema.sh` を実行し、
#         `git diff` を確認してから commit する。pin テストが draft-04 / required を担保する。
set -euo pipefail

URL="https://specs.frictionlessdata.io/schemas/data-package.json"
OUT="src/validate/frictionless/data-package.schema.json"

curl -fsSL "$URL" -o "$OUT"
# 末尾改行を保証(prettier/差分の安定のため)
printf '\n' >>"$OUT"
echo "取得完了: $OUT (取得日 $(date -u +%F))。git diff を確認して commit してください。"
