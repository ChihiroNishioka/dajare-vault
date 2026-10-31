import { writeFileSync } from 'node:fs';
import { buildSeed } from '../src/data/build-seed';

const built = buildSeed();
writeFileSync(
  new URL('../src/data/seed.json', import.meta.url),
  `${JSON.stringify(built.file, null, 2)}\n`,
);

const report = built.map
  .map((entry, index) => {
    const item = built.file.items[index + 6];
    const when = item?.addedAt ?? (item?.addedAtNote || '日付不明');
    const text = entry.text.replaceAll('\n', ' / ');
    return `${String(index + 1).padStart(3)}  L${entry.lines.join(',')}  ${when}  ${text}`;
  })
  .join('\n');
writeFileSync('/tmp/line-map.txt', `${report}\n`);
console.log(`items ${built.file.items.length} family ${built.map.length}`);
