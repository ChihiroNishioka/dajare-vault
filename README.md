# 駄洒落保管庫

思いついた駄洒落を、自分のブラウザに残しておくための静的サイトです。サーバーもアカウントもありません。データは各端末の `localStorage` に入り、端末のあいだは JSON の書き出しと読み込みで受け渡します。

表示名は仮に「駄洒落保管庫」です。ほかの候補は「ダジャレ帳」「ことばのびんづめ」「ダジャレの引き出し」「シャレダス」です。

## 家族メモについて

初期データには、仕様の見本6件に加えて、家族の駄洒落メモを入れています。電話番号やメールアドレスは入っていません。名前や呼び方（ママ、パパなど）は入っています。

GitHub Pages を有効にすると、ビルド済みの JavaScript ごと、この初期データは URL を知っている人から見えます。リポジトリを public にするかどうかと、Pages をオンにするかどうかは、その点を確認してから決めてください。この README の手順だけでは公開されません。

## 開発

```bash
npm ci
npm run dev
```

開発サーバーは `http://localhost:5173/dajare-vault/` です。Vite の `base` は `/dajare-vault/` です。Service Worker はありません。`manifest.webmanifest` の `start_url` とアイコンも同じサブパスです。

```bash
npm test          # Vitest
npm run build
npm run test:e2e  # Playwright（PC 1280 と iPhone 13）
npm run screenshots
```

スクリーンショットは `screenshots/` に出します（コミットしません）。名前は `list_pc_1280.png` のように `{画面}_{pc|iphone}_{幅}.png` です。

## 項目

| 項目                   | 必須 | 内容                                                          |
| ---------------------- | ---- | ------------------------------------------------------------- |
| 本文 `text`            | 必須 | 200文字まで                                                   |
| シーン `scene`         | 必須 | 分からないときは「不明」。100文字まで                         |
| 追加日 `addedAt`       | 任意 | `YYYY-MM-DD`。分からないときは `null`。今日の日付では埋めない |
| 日付メモ `addedAtNote` | 任意 | 例: `10月21日（年不明）`                                      |
| 読み `reading`         | 任意 | ひらがな推奨。外れても保存できる                              |
| 元ネタ `source`        | 任意 |                                                               |
| 評価 `rating`          | 任意 | 星1〜5。空なら `null`                                         |
| お気に入り `favorite`  | 任意 | 既定はオフ                                                    |
| タグ `tags`            | 任意 | 最大10個。候補も用意してある                                  |
| 言った人 `speakers`    | 任意 | 複数可。一覧と絞り込みに出る                                  |
| メモ `memo`            | 任意 | 反応や補足                                                    |
| 更新日時 `updatedAt`   | 自動 | ユーザーは直接編集しない                                      |

評価は星とお気に入りの両方です。端末間の自動同期と独自ドメインはありません。

## iPhone

Safari のタブのまま何日も開かないと、保存が消えることがあります。共有ボタンから「ホーム画面に追加」し、そのアイコンから開いてください。書いたあとは「保管」から JSON を書き出して、ファイルアプリに残します。

## 公開（GitHub Pages）

配信元は `gh-pages` ブランチのルートです。中身は `npm run build` の `dist/` と、Jekyll を止めるための `.nojekyll` だけです。公開URLは次を想定しています。

`https://chihironishioka.github.io/dajare-vault/`

Pages の設定（ブランチを `gh-pages` / root にする）と、リポジトリを public にする作業は、リポジトリの Settings で行います。ここにはトークンも Secrets も置きません。

更新するときは、ソースのブランチでビルドし、`gh-pages` をその成果物で置き換えます。

```bash
npm ci
npm run build
rm -rf .pages
mkdir .pages
cp -a dist/. .pages/
touch .pages/.nojekyll
```

`.pages/` の中身だけを `gh-pages` ブランチのルートにコミットして push します。`main` へはマージしません。
