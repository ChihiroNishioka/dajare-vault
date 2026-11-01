# 教訓

a button that opens a panel must never start a side effect; the side effect starts only from an explicit confirm button, covered by a request-count e2e test

- ヘッダのボタンを取るセレクタは、ヘッダの中に絞る。パネルが開いているあいだ、ページ全体の getByRole ではヘッダが見えなくなる。
- 空の一覧は addInitScript で入れる。localStorage.clear() は見本を入れ直すので使わない。
- e2e は tsc の検査に入る。使っていない変数が 1 つあると、ビルドが落ちてサーバーが起動しない。
