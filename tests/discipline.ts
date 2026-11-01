/** Patterns that make a test pass without watching behavior. */
export function disciplineViolations(source: string): string[] {
  const hits: string[] = [];
  if (/waitForTimeout/.test(source)) hits.push('waitForTimeout');
  if (/\bsetTimeout\s*\(/.test(source)) hits.push('setTimeout');
  if (/\bsetImmediate\s*\(/.test(source)) hits.push('setImmediate');
  if (/\?raw\b/.test(source)) hits.push('raw-import');
  const readable = source.replace(/endsWith\(\s*['"][^'"]*\.tsx?['"]\s*\)/g, '');
  if (/(?:readFile|readFileSync)\b/.test(readable) && /['"`][^'"`]*\.tsx?['"`]/.test(readable)) {
    hits.push('source-read');
  }
  return hits;
}
