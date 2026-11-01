#!/bin/sh
set -eu
cd "$(dirname "$0")/../relay"
npx --yes wrangler@3 deploy
echo "デプロイ後に出た URL を、サイトのビルド環境変数 VITE_NOTION_RELAY_URL に入れてからプレビューを作り直してください。"
