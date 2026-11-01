/** Patterns that make a test pass without watching behavior. */
export function disciplineViolations(source: string): string[] {
  const lines = source.split('\n');
  const aliases = timeoutAliases(lines);
  const hits = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (allowReason(line)) continue;
    kept.push(line);
    if (callsAlias(stripStrings(line), aliases)) hits.add('timers-promises');
  }
  const body = kept.join('\n');
  if (/waitForTimeout/.test(body)) hits.add('waitForTimeout');
  if (/\bsetTimeout\s*\(/.test(body)) hits.add('setTimeout');
  if (/\bsetImmediate\s*\(/.test(body)) hits.add('setImmediate');
  if (/\?raw\b/.test(body)) hits.add('raw-import');
  if (/from\s+['"](?:node:)?timers\/promises['"]/.test(body) && /\bsetTimeout\b/.test(body)) {
    hits.add('timers-promises');
  }
  const readable = body.replace(/endsWith\(\s*['"][^'"]*\.tsx?['"]\s*\)/g, '');
  if (/(?:readFile|readFileSync)\b/.test(readable) && /['"`][^'"`]*\.tsx?['"`]/.test(readable)) {
    hits.add('source-read');
  }
  if (/\breaddirSync\s*\(/.test(body) && /\breadFileSync\s*\(/.test(body)) {
    hits.add('source-walk');
  }
  return [...hits];
}

function timeoutAliases(lines: string[]): Set<string> {
  const aliases = new Set<string>();
  for (const line of lines) {
    const named = line.match(/import\s*\{([^}]+)\}\s*from\s*['"](?:node:)?timers\/promises['"]/);
    if (named) {
      for (const part of named[1].split(',')) {
        const bits = part.trim().split(/\s+as\s+/);
        const original = bits[0]?.trim();
        const local = (bits[1] ?? bits[0])?.trim();
        if (original === 'setTimeout' && local) aliases.add(local);
      }
    }
    const star = line.match(/import\s*\*\s+as\s+(\w+)\s+from\s*['"](?:node:)?timers\/promises['"]/);
    if (star?.[1]) aliases.add(`${star[1]}.setTimeout`);
  }
  return aliases;
}

function callsAlias(code: string, aliases: Set<string>): boolean {
  for (const alias of aliases) {
    const pattern = alias.includes('.')
      ? new RegExp(`${alias.replace('.', '\\.')}\\s*\\(`)
      : new RegExp(`\\b${alias}\\s*\\(`);
    if (pattern.test(code)) return true;
  }
  return false;
}

/** A real comment on this line, with a reason. A marker inside a string does not count. */
function allowReason(line: string): string | null {
  const code = stripStrings(line);
  const match = code.match(
    /\/\*\s*discipline-allow(?:\s+([^*]*?))?\s*\*\/|\/\/\s*discipline-allow(?:\s+(\S.*?))?\s*$/,
  );
  if (!match) return null;
  const reason = (match[1] ?? match[2] ?? '').trim();
  return reason.length > 0 ? reason : null;
}

function stripStrings(line: string): string {
  return line
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}
