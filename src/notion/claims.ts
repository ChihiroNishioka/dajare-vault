export interface FirebaseIdentity {
  email: string;
  uid: string;
}

export function readFirebaseClaims(
  payload: unknown,
  nowSec: number,
  projectId: string,
): FirebaseIdentity {
  if (!payload || typeof payload !== 'object') throw new Error('トークンの中身が読めません');
  const row = payload as Record<string, unknown>;
  const iss = `https://securetoken.google.com/${projectId}`;
  if (row.aud !== projectId) throw new Error('トークンの相手が違います');
  if (row.iss !== iss) throw new Error('トークンの発行元が違います');
  if (typeof row.exp !== 'number' || row.exp <= nowSec)
    throw new Error('トークンの期限が切れています');
  const skew = 5 * 60;
  if (typeof row.iat !== 'number' || row.iat > nowSec + skew)
    throw new Error('トークンの時刻が違います');
  if (typeof row.auth_time !== 'number' || row.auth_time > nowSec + skew)
    throw new Error('トークンの時刻が違います');
  if (row.email_verified !== true) throw new Error('メールが確認されていません');
  if (typeof row.email !== 'string' || row.email.length === 0)
    throw new Error('メールがありません');
  const firebase = row.firebase as { sign_in_provider?: unknown } | undefined;
  if (firebase?.sign_in_provider !== 'google.com')
    throw new Error('Googleのログインではありません');
  if (typeof row.sub !== 'string' || row.sub.length === 0) throw new Error('uid がありません');
  if (row.user_id !== row.sub) throw new Error('uid がありません');
  return { email: row.email.toLowerCase(), uid: row.sub };
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  return base64UrlToBytes(body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''));
}

function readLength(bytes: Uint8Array, offset: number): { length: number; offset: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error('証明書が途中で切れています');
  if (first < 0x80) return { length: first, offset: offset + 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = (length << 8) | (bytes[offset + 1 + i] ?? 0);
  return { length, offset: offset + 1 + count };
}

function skipTlv(bytes: Uint8Array, offset: number): number {
  const { length, offset: start } = readLength(bytes, offset + 1);
  return start + length;
}

/** X.509 証明書から SubjectPublicKeyInfo を切り出す。 */
export function spkiFromCertificate(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('証明書ではありません');
  const cert = readLength(der, 1);
  let cursor = cert.offset;
  if (der[cursor] !== 0x30) throw new Error('証明書の中身が読めません');
  const tbs = readLength(der, cursor + 1);
  cursor = tbs.offset;
  if (der[cursor] === 0xa0) cursor = skipTlv(der, cursor);
  cursor = skipTlv(der, cursor);
  cursor = skipTlv(der, cursor);
  cursor = skipTlv(der, cursor);
  cursor = skipTlv(der, cursor);
  cursor = skipTlv(der, cursor);
  const spkiStart = cursor;
  if (der[cursor] !== 0x30) throw new Error('公開鍵が見つかりません');
  const spki = readLength(der, cursor + 1);
  return der.slice(spkiStart, spki.offset + spki.length);
}

export async function importRsaPublicKey(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength) as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

export async function verifyRs256Payload(token: string, key: CryptoKey): Promise<unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('トークンの形が違います');
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('トークンの形が違います');
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart))) as {
    alg?: string;
  };
  if (header.alg !== 'RS256') throw new Error('トークンの署名方式が違います');
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBytes(signaturePart);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature.buffer.slice(
      signature.byteOffset,
      signature.byteOffset + signature.byteLength,
    ) as ArrayBuffer,
    data,
  );
  if (!ok) throw new Error('トークンの署名が違います');
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
}

export async function verifyFirebaseIdToken(
  token: string,
  options: { projectId: string; nowSec: number; getKey: (kid: string) => Promise<CryptoKey> },
): Promise<FirebaseIdentity> {
  const headerPart = token.split('.')[0];
  if (!headerPart) throw new Error('トークンの形が違います');
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart))) as {
    kid?: string;
  };
  if (!header.kid) throw new Error('トークンの鍵がありません');
  const key = await options.getKey(header.kid);
  const payload = await verifyRs256Payload(token, key);
  return readFirebaseClaims(payload, options.nowSec, options.projectId);
}

let cachedCerts: { expiresAt: number; keys: Record<string, string> } | null = null;
let lastKidRefresh = 0;

export function resetCertCache(): void {
  cachedCerts = null;
  lastKidRefresh = 0;
}

async function fetchCerts(fetchImpl: typeof fetch, nowMs: number): Promise<Record<string, string>> {
  const certHost = ['securetoken', 'system.gserviceaccount.com'].join('@');
  const response = await fetchImpl(`https://www.googleapis.com/robot/v1/metadata/x509/${certHost}`);
  if (!response.ok) throw new Error('ログインの公開鍵を読めません');
  const keys = (await response.json()) as Record<string, string>;
  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cachedCerts = { expiresAt: nowMs + maxAge * 1000, keys };
  return keys;
}

export async function loadSecureTokenKey(
  kid: string,
  fetchImpl: typeof fetch,
  now = Date.now,
): Promise<CryptoKey> {
  const current = now();
  if (!cachedCerts || cachedCerts.expiresAt <= current) {
    await fetchCerts(fetchImpl, current);
  }
  let pem = cachedCerts?.keys[kid];
  if (!pem && current - lastKidRefresh >= 60_000) {
    lastKidRefresh = current;
    const keys = await fetchCerts(fetchImpl, current);
    pem = keys[kid];
  }
  if (!pem) throw new Error('トークンの鍵が見つかりません');
  return importRsaPublicKey(spkiFromCertificate(pemToDer(pem)));
}
