# 駄洒落保管庫

思いついた駄洒落を、自分のブラウザに残しておくための静的サイトです。サーバーもアカウントもありません。データは各端末の `localStorage` に入り、端末のあいだは JSON の書き出しと読み込みで受け渡します。

表示名は仮に「駄洒落保管庫」です。ほかの候補は「ダジャレ帳」「ことばのびんづめ」「ダジャレの引き出し」「シャレダス」です。

## 家族メモについて

初期データには、仕様の見本6件に加えて、家族の駄洒落メモを入れています。電話番号やメールアドレスは入っていません。名前や呼び方（ママ、パパなど）は入っています。

GitHub Pages を有効にすると、ビルド済みの JavaScript ごと、この初期データは URL を知っている人から見えます。リポジトリを public にするかどうかと、Pages をオンにするかどうかは、その点を確認してから決めてください。この README の手順だけでは公開されません。

## 家族で共有する

Firebase（Google ログインと Firestore）を足すと、URL を知っている人は誰でも読め、許可した Google アカウントだけが追加・編集・削除できます。設定の手順は [docs/firebase-setup.md](docs/firebase-setup.md) です。Web 設定は `src/firebase-config.ts` に入っています。ルールを入れるまでは「まだ準備中です」と出ます。テストは `VITE_FORCE_LOCAL=1` で、この端末だけの動作を見ます。無料プランには自動バックアップがないので、定期的に JSON を書き出してください。

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

スクリーンショットは `screenshots/` に出します（コミットしません）。名前は `list_pc_1280.png` のように `{画面}_{pc|iphone}_{幅}.png` です。必須の印の e2e は `SCREENSHOT_DIR` があればそのディレクトリへ保存し、無ければ `screenshots/` です。保存に失敗すると、そのテストも失敗します。

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

更新するときは、ソースのブランチでビルドし、`gh-pages` をその成果物で置き換えます。次の順に進めます。途中のコマンドが失敗したら、先へ進まず原因を直します。

1. ビルドして `.pages/` を作ります。括弧の中は `set -e` で動くので、どこかが失敗するとそこで止まります。リレーの URL は `RELAY` に1回だけ書き、ビルドと確認に使い回します。ビルドに URL が入っていないと、`vite build` かその後の `grep` が失敗します。

   ```bash
   (
     set -e
     RELAY=https://dajare-notion-backup.chihiro-nishioka.workers.dev
     npm ci
     VITE_NOTION_RELAY_URL="$RELAY" npm run build
     grep -lF "$RELAY" dist/assets/*.js
     rm -rf .pages
     mkdir .pages
     cp -a dist/. .pages/
     touch .pages/.nojekyll
   )
   ```

2. 手順1が最後まで通ったときだけ、`.pages/` の中身だけを `gh-pages` ブランチのルートにコミットして push します。`main` へはマージしません。

3. 反映を待ちます。Actions の `pages-build-deployment` が成功してから、次のコマンドで確認します。公開ページが読み込む JavaScript のパス（`assets/index-xxxx.js` の形）を調べ、その中にリレーの URL が入っていることを確かめます。

   ```bash
   (
     set -e
     RELAY=https://dajare-notion-backup.chihiro-nishioka.workers.dev
     SITE=https://chihironishioka.github.io/dajare-vault
     JS=$(curl -fsSL "$SITE/" | grep -oE 'assets/[^" ]+\.js' | head -n 1)
     test -n "$JS"
     echo "$JS"
     curl -fsSL "$SITE/$JS" | grep -qF "$RELAY"
     echo OK
   )
   ```

4. リレーが公開元の Origin を許すことを確かめます。応答コードが `204` で、`access-control-allow-origin`、`access-control-allow-methods`、`access-control-allow-headers` が揃っていないと失敗します。

   ```bash
   (
     set -e
     RELAY=https://dajare-notion-backup.chihiro-nishioka.workers.dev
     ORIGIN=https://chihironishioka.github.io
     H=$(curl -sS -D - -o /dev/null -X OPTIONS \
       -H "Origin: $ORIGIN" \
       -H 'Access-Control-Request-Method: POST' \
       -H 'Access-Control-Request-Headers: authorization,content-type' \
       "$RELAY" | tr -d '\r')
     echo "$H"
     echo "$H" | head -n 1 | grep -q ' 204'
     echo "$H" | grep -iqx "access-control-allow-origin: $ORIGIN"
     echo "$H" | grep -iqE '^access-control-allow-methods:.*POST'
     echo "$H" | grep -iqE '^access-control-allow-headers:.*authorization'
     echo OK
   )
   ```
