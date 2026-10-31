/** 呼び出し元のトークンで、自分の editors 文書が読めるときだけ編集者。名簿の写しは持たない。 */
export async function confirmEditor(
  projectId: string,
  email: string,
  idToken: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/editors/${encodeURIComponent(email)}`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${idToken}` } });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error('編集者の確認ができませんでした');
  return true;
}
