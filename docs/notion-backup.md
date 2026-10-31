# Notion に保管する

保管庫の紙を、指定した Notion ページへ控えとして書き出します。GitHub Pages は静的なので、ブラウザから Notion API を直接は呼びません。トークンをページに載せると誰でも使えるためです。

## リレー

Cloudflare Workers の無料枠を使います。Firebase Functions は Blaze（従量課金の契約）が必要なので使いません。Workers の無料枠は 1 日 10 万リクエストまでで、この保管の回数なら足ります。

ブラウザは Firebase の ID トークンを付けてリレーへ POST します。リレーは次を確認してから Notion を叩きます。

- 署名（Google の `securetoken` 公開鍵、RS256）
- `aud` が `dajare-vault`
- `iss` が `https://securetoken.google.com/dajare-vault`
- `exp` が今より先
- `email_verified` が true
- Firestore の `editors/<小文字のメール>` が、そのトークンで読めること

名簿の写しはリレーに持ちません。いま編集者なのは、Firestore に入っている次の文書です。コンソールで足したり外したりした人が、そのまま保管できる人になります。

- `chihiro.nishioka@gmail.com`
- `contextos2026@gmail.com`
- `housekeeping2011@gmail.com`

CORS は `https://chihironishioka.github.io` だけです。プレビュー（`/dajare-vault/preview/`）も同じオリジンなので通ります。

## Notion の形

ページ `40aa4f0d731080219235dfc54ab9683c` の下に、データベース「駄洒落」を作ります。すでにあればそれを使います。1行が紙1枚です。

| 列                                         | 内容                                  |
| ------------------------------------------ | ------------------------------------- |
| 本文                                       | タイトル。改行は空白に畳む            |
| 全文                                       | 本文そのまま                          |
| id                                         | Firestore の文書 id。突き合わせに使う |
| 場面、読み、出典、メモ、追加日、追加日メモ | 文字列                                |
| 評価                                       | 数値                                  |
| お気に入り、アーカイブ                     | チェック                              |
| タグ、言った人                             | 改行区切り                            |
| 作成、更新                                 | 時刻の文字列                          |
| 書いた人、直した人                         | 表示名だけ。メールは入れない          |
| 照合                                       | 中身の指紋。同じなら書き直さない      |

再実行は id で既存行を探し、更新します。同じ id の行を新しくは作りません。余分にできてしまった同じ id は、2件目以降をアーカイブします。

## 消した紙

Notion の行は消しません。保管庫に無い id は「アーカイブ」にチェックを入れます。誤って消した紙の文面を、控えから読めるようにするためです。同じ id をあとから足すと、チェックを外して中身を更新します。id の無い行（手で足した行）は触りません。

最終保管の時刻は、データベースの説明文 `最終保管 <ISO時刻>` に残し、画面にも出します。

## 速さ

Notion はおおよそ毎秒3回までです。リレーは 340ms 以上間隔を空け、429 のときは `Retry-After` か指数で待ってからやり直します。ブラウザは 10 件ずつ送り、アーカイブも 1 回の応答で 12 件までにして、Workers の制限時間に収まるようにしています。119 件より増えても、続きのリクエストで再開できます。

## 画面

ヘッダの「Notionに保管」は「保管」の左です。どちらも、ログインしているときだけ出ます。ログアウトすると、ページを移らずにその場で消えます。`#settings` と `#notion` は、ログインしていないと開きません。

実行中は「送っています… N/全部」と出て、ボタンは押せません。終わると、新しく作った件数、更新した件数、そのままの件数、しまった件数、最終保管の時刻を出します。失敗したときは理由を出し、もう一度押せます。

## 持ち主がやること

トークンはこのチャットにもリポジトリにも書きません。次の順です。

1. [Notion の統合](https://www.notion.so/profile/integrations) を作る。機能は「コンテンツを読み取る」「コンテンツを挿入する」「コンテンツを更新する」。
2. 控えを置くページ（`https://app.notion.com/p/40aa4f0d731080219235dfc54ab9683c`）を、その統合に共有する。
3. Cloudflare のアカウントを自分で作る（こちらでは作りません）。
4. 秘密 `NOTION_TOKEN` を Worker に入れる。値は統合のトークンです。

   ```bash
   cd relay
   npx --yes wrangler@3 secret put NOTION_TOKEN
   ```

   ページ id は秘密ではありません。`relay/wrangler.toml` の `NOTION_PAGE_ID` に入っています。

5. デプロイする。手元なら `sh scripts/deploy-notion-relay.sh`。GitHub なら Actions の「notion-relay」を手動で走らせる。そのときリポジトリの Actions 秘密が要ります。

   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

6. 出た Worker の URL を、サイトをビルドするときの環境変数 `VITE_NOTION_RELAY_URL` に入れる。例: `https://dajare-notion-backup.<アカウント名>.workers.dev` 。リレーはパスを見ずに受けます。
7. プレビューをその変数付きで作り直す。変数が空のあいだ、ボタンは「Notion保管のリレーが未設定です」と出して止まります。Notion へは書きません。

Worker の入口は `relay/src/index.ts` です。
