import { expect, it } from 'vitest';
import { logLine } from './log';

it('prefixes the level word', () => {
  expect(logLine('WARN', 'x')).toBe('WARN  x');
});
