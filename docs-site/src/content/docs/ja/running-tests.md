---
title: テストの実行
description: pnpm check が見る範囲、意図的に skip される corpus テスト、そして CI が回すもの
---

日常的に使うものは 1 コマンドに収まっています。

```sh
pnpm check
```

`pnpm audit` を走らせたあと、パッケージごとに `typecheck → lint → build → test`
を回します。4 パッケージを依存順に処理するので、壊れたときは**原因のパッケージ**で
止まります ― 3 つ下流で気づくことにはなりません。

**ここまでにネットワークもコンテナも、ディスク上の WACZ も必要ありません。**
それを必要とする唯一のスイートは、明示的に指定しない限り skip されます（後述）。

## コマンド

| コマンド | 範囲 |
| --- | --- |
| `pnpm check` | audit + 4 パッケージ全部。**CI が回すもの。** |
| `pnpm test` | テストのみ、全パッケージ |
| `pnpm --filter @waxlens/core test` | 1 パッケージだけ |
| `pnpm --filter @waxlens/core test:watch` | 1 パッケージを watch |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | 1 段階を全パッケージに |
| `pnpm test:ui` | ブラウザの UI で全パッケージ（watch） |
| `pnpm test:report` | `html/` に静的レポート |

`--filter` に渡すのはディレクトリ名ではなく**パッケージ名**です ―
`@waxlens/core`、`@waxlens/daemon`、`@waxlens/protocol`、`@waxlens/tui`。

`@waxlens/protocol` にはテストがありません。ここは wire contract そのもので、
`check` は `build` で終わります。抜けているのではなく、**走らせるものが無い**からです。

## 観点で絞る

テストには**観点のタグ**が付いています。ファイル名やディレクトリではなく、
**何を検査しているか**で引けます。

```bash
pnpm exec vitest --listTags                        # 語彙の一覧
pnpm exec vitest run --tagsFilter frictionless     # 13 件
pnpm exec vitest run --tagsFilter 'docs && i18n'   # 2 件
pnpm exec vitest run --tagsFilter '!corpus'
pnpm test:ui --tagsFilter frictionless             # UI を絞って開く
```

UI を開いたあとは、検索欄に `tag:frictionless` と打っても同じです。

| タグ | 意味 |
| --- | --- |
| `frictionless` | WACZ が土台にする Data Package の検査 |
| `wacz` | WACZ の構造（必須ファイル・予約ディレクトリ） |
| `cdxj` | 索引フォーマットと wabac 互換 |
| `warc` | WARC レコードとダイジェスト |
| `engine` | ルールを束ねて回す層 |
| `corpus` | コーパス駆動。実アーカイブを開く |
| `docs` | ドキュメントとコードの整合 |
| `i18n` | メッセージと翻訳 |
| `cli` | コマンドライン表面 |
| `remote` | S3 越しの読み取り |
| `daemon` / `tui` | それぞれのパッケージ |

:::caution[速さのためではありません]
全 203 件が 3.5 秒で終わります。**絞る目的は「引けること」だけ**で、
実行時間ではありません。Vitest の tags にはタグ側で `timeout` や `retry` を
指定する用途もありますが、**この repo では使っていません** ――
実行方針を分けたいテストの種類が無いからです。
:::

### タグを足すとき

**順序が決まっています。**

1. ルートの `vitest.config.ts` の `tags` に**語彙を宣言する**
2. テストファイルの冒頭に `// @module-tag <名前>` を書く

逆にすると `strictTags`（既定で有効）が働き、**1 件も走らずにエラーで止まります**。

ファイル全体ではなく 1 件だけに付けたいときは、テスト側の options を使います ――
`it("…", { tags: ["frictionless"] }, () => {…})`。
`rule-docs.test.ts` が実例で、ファイルとしては `docs` ですが、
その中の 1 件だけが `frictionless` でもあります。

`packages/core/test/test-tags.test.ts` が**付け忘れと使われない語彙を落とします**。
`strictTags` が捕まえるのは「宣言していないタグを使った」だけで、逆向きは捕まえません。

## UI で見る

```bash
pnpm test:ui
```

`core`・`daemon`・`tui` を**1 つの画面**に集めます。ルートの `vitest.config.ts` が
`projects` で各パッケージの config を指しているだけなので、`include` や
`environment` の定義はパッケージ側の 1 か所のままです ―― UI 用に設定が
二重化することはありません。

`pnpm test` は変わらず `pnpm -r test` を通ります。**両者が走らせる集合は同じ**で、
それは合計が一致することで確かめてあります（190 passed / 10 skipped）。

`pnpm test:report` は `html/` に静的レポートを出します。
**`file://` では開けません** ―― `npx vite preview --outDir html` のように配信してください。

:::note
`@waxlens/protocol` は `projects` に入れていません。テストが無いので、
入れると UI に**空のプロジェクト**が並び、「テストが足りない」と読めてしまいます。
「走らせるものが無い」のであって、欠けているのではありません。
:::

## なぜ `build` が `test` より前なのか

各パッケージの `check` は `typecheck && lint && build && test` で、この順序は意図的です。
`@waxlens/daemon` と `@waxlens/tui` はビルドの一部として `build-info.ts` を生成するので、
古いまま（あるいは無いまま）テストを回すと**別物を検査する**ことになります。
型エラーと lint は数秒で終わるのに対しビルドは長い ― 安いゲートを先に置く、という理由もあります。

## corpus テスト

`@waxlens/core` にはもう 1 種類のテストがあります。インラインで組み立てた fixture ではなく、
[waxlens-corpus](/corpus/) リポジトリの**実物の WACZ** を検証するものです。
アーカイブ本体が要るので `CORPUS_DIR` を読み、**未設定なら skip します**。

```
Test Files  20 passed | 2 skipped (22)
      Tests  113 passed | 4 skipped (117)
```

通常の `pnpm check` はこう見えます。この skip があるおかげで、日常のコマンドは
外部に依存しないままでいられます。

走らせるには、corpus をこのリポジトリの隣にクローンし、**絶対パス**で指し示します。

```sh
CORPUS_DIR="$(cd ../waxlens-corpus && pwd)" pnpm --filter @waxlens/core test:corpus
```

`$(cd … && pwd)` は飾りではありません。`pnpm --filter` は作業ディレクトリを
`packages/core` に移してスクリプトを走らせるので、相対パスの `CORPUS_DIR` は
シェルではなくそこを基準に解決されます。つまり `../waxlens-corpus` は
`packages/waxlens-corpus` を探しに行き、何も見つからず、**「manifest が無い」と
言いながら skip します**。シェルの側で先に絶対パスへ変換しておけば、この問題自体が
起きません。

| script | 内容 |
| --- | --- |
| `test:corpus` | corpus の全アーカイブを検証し、`manifest.json` と突き合わせる |
| `corpus:docs:check` | `docs/examples.md` が corpus からずれていたら失敗させる |
| `corpus:build` | アーカイブと manifest を**再生成する** |

:::danger[`corpus:build` は書く前に消します]
`$CORPUS_DIR/fixtures` を**丸ごと**削除してから作り直します。corpus リポジトリが
追跡していないものは復元不能に消えます ― 実際に作業が失われたことがあります。

実行前に corpus リポジトリで `git status` を確認してください。そして
**再生成できないアーカイブが入ったディレクトリを `CORPUS_DIR` に指定しないでください。**
:::

## CI が回すもの

5 つの workflow があり、ローカルで `pnpm check` として再現できるのは最初の 1 つだけです。

| workflow | 内容 |
| --- | --- |
| `check` | `pnpm check` ― 日常のスイート全部 |
| `corpus` | waxlens-corpus をクローンし、`corpus:docs:check` と `test:corpus` |
| `pack-smoke` | `@waxlens/core` と `@waxlens/tui` を `npm pack` し、まっさらなディレクトリに入れてバイナリを実行 |
| `site` | ドキュメントをビルドし、参照を検証 |
| `docs` | サイトを公開 |

`pack-smoke` は他が捕まえられないものを捕まえます ― **ここではビルドもテストも通るのに、
壊れた tarball を出荷してしまう**ケースです。`files` の指定漏れや、バイナリの実行権限が
落ちているといった類のものです。
