import { verifyFirebaseIdToken, loadSecureTokenKey } from '../../src/notion/claims';
import { backupCors } from '../../src/notion/cors';
import { confirmEditor } from '../../src/notion/editors';
import { handleNotionBackup } from '../../src/notion/handler';
import { createNotionClient } from '../../src/notion/notion-api';

interface RelayEnv {
  NOTION_TOKEN?: string;
  NOTION_PAGE_ID?: string;
}

const PAGE_ID = '40aa4f0d731080219235dfc54ab9683c';

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    if (!env.NOTION_TOKEN) {
      const cors = backupCors(request.headers.get('origin'));
      if (request.method === 'OPTIONS') {
        if (!cors) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: cors });
      }
      const headers = new Headers(cors ?? undefined);
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({ error: 'リレーの秘密が未設定です' }), {
        status: 500,
        headers,
      });
    }
    const pageId = env.NOTION_PAGE_ID || PAGE_ID;
    return handleNotionBackup(request, {
      nowSec: () => Math.floor(Date.now() / 1000),
      verifyToken: (idToken) =>
        verifyFirebaseIdToken(idToken, {
          projectId: 'dajare-vault',
          nowSec: Math.floor(Date.now() / 1000),
          getKey: (kid) => loadSecureTokenKey(kid, fetch),
        }),
      confirmEditor: (email, idToken) => confirmEditor('dajare-vault', email, idToken, fetch),
      notion: createNotionClient({ token: env.NOTION_TOKEN, pageId, fetchImpl: fetch }),
    });
  },
};
