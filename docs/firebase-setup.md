# Firebase の準備

共有に使うのは Authentication（Google）と Firestore だけです。Spark（無料）プランで足ります。Hosting は今までどおり GitHub Pages です。

値が決まるまでは `src/firebase-config.ts` の `firebaseConfig` は `null` のままにしてください。そのあいだサイトは、今までどおりその端末の中だけに保存します。

## 1. プロジェクトを作る

1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作る。
2. プロジェクトの設定 → マイアプリ → ウェブアプリを追加する。
3. 表示された `apiKey`、`authDomain`、`projectId`、`appId` を `src/firebase-config.ts` の `firebaseConfig` に入れる。この4つはブラウザに載る値で、秘密鍵ではありません。
4. Authentication → ログイン方法 → Google を有効にする。
5. Authentication → 設定 → 承認済みドメインに `chihironishioka.github.io` と、動作確認に使う `localhost` を足す。

## 2. 編集者を足す

編集できる人は、Firestore の `editors` コレクションにドキュメントを1つ足すだけで増えます。ルールの書き換えは要りません。

1. Firestore を本番モードで作る（ルールは次の節でリポジトリの `firestore.rules` を入れます）。
2. コレクション `editors` を作る。
3. ドキュメント ID は、その人の Google アカウントのメールアドレスを**小文字**にしたもの。中身は空で構いません（例: フィールド `name` に表示名を書いても、ルールは中身を見ていません）。
4. 最初に入れる2人のアドレスは、ちひろの確認が終わってからコンソールに足してください。ルールファイルやこの説明には、確認前のアドレスを書いていません。

本人以外は、誰が編集者かを一覧できません。自分のドキュメントを読めるかどうかだけが、編集者かどうかの判定です。

## 3. ルールを入れる

リポジトリ直下の `firestore.rules` が正です。コンソールに貼っても、CLI でも同じです。

```bash
npx firebase login
npx firebase deploy --only firestore:rules --project <プロジェクトID>
```

初回は `firebase init firestore` で既存の `firestore.rules` を選んでください。ファイルを上書きしないこと。

ルールのテストは、Java の入った環境で次を実行します。CI も同じです。

```bash
npm run test:rules
```

## 4. 紙を共有DBへ移す

設定を入れてサイトを開くと、Google でログインできます。`editors` に入っている人だけ、追加・編集・削除が出ます。

共有DBが空のとき、その人には「初期データ（119件）を共有DBに入れる」が出ます。id が同じ紙は飛ばすので、何回押しても二重にはなりません。

この端末に以前の保存が残っているときは、「この端末のデータを共有DBへ送る」が一度だけ出ます。こちらも、すでにある id は飛ばします。

JSON の書き出しは、ログインしていなくてもできます。読み込みは編集者だけです。
