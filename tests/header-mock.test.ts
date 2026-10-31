import { describe, expect, it } from 'vitest';
import { parseHeaderMock, readHeaderMock } from '../src/session';

describe('header mock', () => {
  it('maps the query to a screen-only account', () => {
    expect(parseHeaderMock('?mock=signed-out')).toEqual({ kind: 'signed-out' });
    expect(parseHeaderMock('mock=editor')).toEqual({
      kind: 'signed-in',
      name: 'ちひろ',
      editor: true,
    });
    expect(parseHeaderMock('?mock=viewer')).toEqual({
      kind: 'signed-in',
      name: 'ちひろ',
      editor: false,
    });
    const long = parseHeaderMock('?mock=long');
    expect(long).toMatchObject({ kind: 'signed-in', editor: true });
    expect(long?.kind === 'signed-in' ? [...long.name].length : 0).toBeGreaterThanOrEqual(8);
  });

  it('ignores anything that is not a known screen', () => {
    expect(parseHeaderMock('')).toBeNull();
    expect(parseHeaderMock('?mock=admin')).toBeNull();
    expect(parseHeaderMock('?mock=')).toBeNull();
    expect(parseHeaderMock('?other=editor')).toBeNull();
  });

  it('stays off in a production cloud build', () => {
    const cloudBuild = import.meta.env.PROD && import.meta.env.VITE_FORCE_LOCAL !== '1';
    const read = readHeaderMock('?mock=editor');
    expect(read).toEqual(cloudBuild ? null : parseHeaderMock('?mock=editor'));
  });
});
