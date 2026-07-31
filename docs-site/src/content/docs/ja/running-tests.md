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

`--filter` に渡すのはディレクトリ名ではなく**パッケージ名**です ―
`@waxlens/core`、`@waxlens/daemon`、`@waxlens/protocol`、`@waxlens/tui`。

`@waxlens/protocol` にはテストがありません。ここは wire contract そのもので、
`check` は `build` で終わります。抜けているのではなく、**走らせるものが無い**からです。

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
