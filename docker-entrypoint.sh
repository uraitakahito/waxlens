#!/bin/sh
# Dev container entrypoint.
#
# 役割: compose.dev.yaml が `/app/node_modules` (および各 package の同名 dir)
# を named volume で shadow しているが、Docker が new volume を作るときの
# 初期 owner は root。そのまま `node` user に drop すると `pnpm install`
# が EACCES で失敗するので、先に chown してから drop する。
#
# image を直接 `docker run` する場合 (named volume なし) は dir が存在
# しないので chown はスキップされ、結果として `bash` が node 経由で起動
# するだけ — bind mount 無しの素の image でも同じ振る舞いになる。
set -e

for dir in /app/node_modules /app/packages/core/node_modules /app/packages/tui/node_modules; do
  if [ -d "$dir" ]; then
    chown node:node "$dir"
  fi
done

exec runuser -u node -- "$@"
