/** Patterns that make a test pass without watching behavior. Lines marked discipline-allow are deadlines, not sleeps. */
export function disciplineViolations(source: string): string[] {
  const lines = source.split('\n');
  const body = lines
    .filter((line, index) => {
      if (line.includes('discipline-allow')) return false;
      return !lines[index + 1]?.includes('discipline-allow');
    })
    .join('\n');
  const hits: string[] = [];
  if (/waitForTimeout/.test(body)) hits.push('waitForTimeout');
  if (/\bsetTimeout\s*\(/.test(body)) hits.push('setTimeout');
  if (/\bsetImmediate\s*\(/.test(body)) hits.push('setImmediate');
  if (/\?raw\b/.test(body)) hits.push('raw-import');
  if (/from\s+['"](?:node:)?timers\/promises['"]/.test(body) && /\bsetTimeout\b/.test(body)) {
    hits.push('timers-promises');
  }
  const readable = body.replace(/endsWith\(\s*['"][^'"]*\.tsx?['"]\s*\)/g, '');
  if (/(?:readFile|readFileSync)\b/.test(readable) && /['"`][^'"`]*\.tsx?['"`]/.test(readable)) {
    hits.push('source-read');
  }
  if (/\breaddirSync\s*\(/.test(body) && /\breadFileSync\s*\(/.test(body)) {
    hits.push('source-walk');
  }
  return hits;
}
