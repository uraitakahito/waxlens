---
title: アーキテクチャ
description: なぜ 4 つの package と stateless な daemon なのか。
---

## 4 つの package

| Package | bin | 役割 |
| ------- | --- | ---- |
| `@waxlens/core` | `waxlens-validate` | Validation engine。WACZ を読み、rule を実行し、machine-readable な report を出す。他を使わず CI から直接呼べる。 |
| `@waxlens/daemon` | `waxlens-daemon` | stateless な HTTP/WS daemon。core を所有し、解決済み(message / specUrl / conformance を inline した)report を返す。 |
| `@waxlens/tui` | `waxlens` | 対話的な terminal UI。daemon の薄いクライアント。 |
| `@waxlens/protocol` | — | クライアントと daemon が共有する wire 型と CLI 契約。runtime では core に依存しないので browser-safe。 |

`waxlens` は既定で `waxlens-daemon` を子プロセスとして起動します。常駐 daemon に
繋ぐ場合は `--server ws://127.0.0.1:PORT` を渡します。

## なぜ daemon を挟むのか

validator は単一バイナリでも作れます。分離しているのは、**同じ report を
複数の frontend が提示できるようにする**ためです。

```mermaid
flowchart LR
    tui["@waxlens/tui"] ==>|"WS / JSON-RPC"| daemon["@waxlens/daemon"]
    browser(["browser (将来)"]) -.->|"WS"| daemon
    daemon -->|"検証に使う"| core["@waxlens/core"]
    tui -->|import| protocol["@waxlens/protocol"]
    daemon -->|import| protocol
    protocol -.->|"import type のみ"| core

    classDef contract fill:#fff3cd,stroke:#d4a72c,color:#5c4500;
    classDef future fill:#eeeeee,stroke:#999999,color:#666666;
    class protocol contract;
    class browser future;
```

daemon が state を持たないことが、それを安価にしています。2 つ目の frontend は
新しいクライアントであって、engine の複製ではありません。

## core が prose を持たない理由

`@waxlens/core` は人間可読な文を一切生成しません。issue が持つのはメッセージの
**キー**とランタイム値で、renderer が locale カタログで解決します。

これが、1 つの report を複数言語で提示できる理由であり、`@waxlens/protocol` が
core 本体を引き込まずに core の型だけを使える理由でもあります — wire format は
テキストではなくデータです。

## rule もデータ

各 rule は `name` / `severity` / `conformance` と profile ごとの上書きを宣言し、
engine は個別に特別扱いせずその宣言を読みます。このサイトの
[Rules](/waxlens/ja/rules/) の表は同じ宣言から生成しているので、実際に走るものと
ずれません。

rule が有効になるのは、`packages/core/src/validate/rules/` に定義があり、**かつ**
同ディレクトリの `index.ts` に載っているときだけです。docs のビルドが両者の件数を
突き合わせます。

## 開発

```sh
pnpm install --frozen-lockfile   # workspace の依存 + symlink
pnpm check                       # audit + 各 workspace の check
pnpm build
```

`docs-site/` は意図的に pnpm workspace の**外**に置き、npm で install します。
workspace に入れると Astro のビルドスクリプトを `allowBuilds` の許可リストに
足すことになり、本体の install を壊すリスクを、得るものなく抱え込むからです。
