/** Patterns that make a test pass without watching behavior. */
export function disciplineViolations(source: string): string[] {
  const lines = scanLines(source);
  const aliases = timeoutAliases(lines.map((line) => line.code).join('\n'));
  const hits = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (line.allowed) continue;
    kept.push(line.raw);
    if (callsAlias(line.code, aliases)) hits.add('timers-promises');
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

type ScannedLine = { raw: string; code: string; allowed: boolean };

/** Comments count only outside strings. A template can cross lines; only its own line is allow-exempt. */
function scanLines(source: string): ScannedLine[] {
  let inTemplate = false;
  let templateExpr = 0;
  let inBlock = false;
  return source.split('\n').map((raw) => {
    let code = '';
    let allowed = false;
    let quote: "'" | '"' | null = null;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      const next = raw[i + 1];
      if (inBlock) {
        if (c === '*' && next === '/') {
          inBlock = false;
          i += 1;
        }
        continue;
      }
      if (inTemplate && templateExpr === 0) {
        if (c === '\\') {
          i += 1;
          continue;
        }
        if (c === '`') inTemplate = false;
        else if (c === '$' && next === '{') {
          templateExpr = 1;
          i += 1;
        }
        continue;
      }
      if (quote) {
        code += c;
        if (c === '\\') {
          code += next ?? '';
          i += 1;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (templateExpr > 0 && c === '{') templateExpr += 1;
      if (templateExpr > 0 && c === '}') {
        templateExpr -= 1;
        if (templateExpr === 0) continue;
      }
      if (c === '/' && next === '/') {
        if (allowText(raw.slice(i + 2))) allowed = true;
        break;
      }
      if (c === '/' && next === '*') {
        const end = raw.indexOf('*/', i + 2);
        const inner = end === -1 ? raw.slice(i + 2) : raw.slice(i + 2, end);
        if (allowText(inner)) allowed = true;
        if (end === -1) inBlock = true;
        else i = end + 1;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        code += c;
        continue;
      }
      if (c === '`') {
        inTemplate = true;
        continue;
      }
      code += c;
    }
    return { raw, code, allowed };
  });
}

function allowText(text: string): boolean {
  const match = text.match(/^\s*discipline-allow(?:\s+(\S.*?))?\s*(?:\*\/)?\s*$/);
  return Boolean(match?.[1]?.trim());
}

function timeoutAliases(code: string): Set<string> {
  const aliases = new Set<string>();
  for (const match of code.matchAll(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"](?:node:)?timers\/promises['"]/g,
  )) {
    for (const part of match[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const original = bits[0]?.trim();
      const local = (bits[1] ?? bits[0])?.trim();
      if (original === 'setTimeout' && local) aliases.add(local);
    }
  }
  for (const match of code.matchAll(
    /import\s*\*\s+as\s+(\w+)\s+from\s*['"](?:node:)?timers\/promises['"]/g,
  )) {
    if (match[1]) aliases.add(`${match[1]}.setTimeout`);
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
