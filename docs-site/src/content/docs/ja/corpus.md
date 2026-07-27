---
title: Corpus
description: 意図的に失敗する実物の archive と、その入手方法。
---

[waxlens-corpus](https://github.com/uraitakahito/waxlens-corpus) は WACZ 標本の
companion リポジトリです。特定の rule を意図的に踏む archive と、踏まない archive が
入っています。rule の挙動を、合成 fixture ではなく**実際のバイト列**に対して
示し、回帰テストするためのものです。

## archive の入手方法

WACZ は **Git LFS** 管理です。実体を得る方法は 3 つあります。

```sh
# A. clone(git-lfs があれば実体まで smudge される)
git clone https://github.com/uraitakahito/waxlens-corpus

# B. 1 本だけ HTTP で取得(LFS の実体は media URL から。raw URL は不可)
base=https://media.githubusercontent.com/media/uraitakahito/waxlens-corpus/main/fixtures
curl -sL "$base/good.wacz" -o good.wacz

# C. waxlens から決定的に再生成(DL 不要・byte 同一)
CORPUS_DIR=../waxlens-corpus pnpm --filter @waxlens/core corpus:build
```

方法 C があるのは、標本が**集めたものではなく生成したもの**だからです。同じ入力から
同じバイト列が出るので、corpus の checkout は利便性であって真実の源ではありません。

## カタログ

標本カタログは corpus の `manifest.json` から `corpus:docs` が生成します。この
ファイルは LFS 対象外の素の JSON なので、カタログの再生成に archive の実体も
`git lfs pull` も要りません。

各標本は「どの rule を、どの profile で踏むはずか」を記録しています。これが corpus を
fixture 集合として使える理由です — rule の挙動が変われば、謎の失敗ではなく
**期待値の差分**として現れます。

## rule を書くときの使い方

標本を直接 waxlens に渡します。

```sh
waxlens-validate --profile spec       path/to/corpus/fixtures/<name>.wacz
waxlens-validate --profile lenient    path/to/corpus/fixtures/<name>.wacz
```

同じ archive を 2 つの profile で走らせるのが、profile が実際に何を組み替えるかを
見る最短の方法です。意味は[プロファイル](/waxlens/ja/profiles/)に、
どの rule に上書きがあるかは [Rules](/waxlens/ja/rules/) の表にあります。
