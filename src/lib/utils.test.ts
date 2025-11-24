import { describe, it, expect } from 'vitest';
import { formatBytes, formatDate, truncateText } from './utils';

describe('formatBytes', () => {
  it('returns "0 Bytes" for zero', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('formats bytes correctly', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
    expect(formatBytes(1)).toBe('1 Bytes');
  });

  it('formats kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2048)).toBe('2 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });

  it('formats gigabytes correctly', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
    expect(formatBytes(2147483648)).toBe('2 GB');
  });

  it('handles decimal precision', () => {
    // Should round to 2 decimal places
    expect(formatBytes(1126)).toBe('1.1 KB');
    expect(formatBytes(1178000)).toBe('1.12 MB');
  });
});

describe('formatDate', () => {
  it('formats date in US locale with month, day, year', () => {
    // Use local date to avoid timezone shifts
    const date = new Date(2024, 2, 15); // March 15, 2024 (month is 0-indexed)
    const result = formatDate(date);
    // Format: "March 15, 2024"
    expect(result).toContain('March');
    expect(result).toContain('15');
    expect(result).toContain('2024');
  });

  it('formats different months correctly', () => {
    const january = new Date(2024, 0, 15); // January 15, 2024
    expect(formatDate(january)).toContain('January');

    const december = new Date(2024, 11, 25); // December 25, 2024
    expect(formatDate(december)).toContain('December');
  });

  it('handles different years', () => {
    const date2023 = new Date(2023, 5, 15); // June 15, 2023
    expect(formatDate(date2023)).toContain('2023');

    const date2025 = new Date(2025, 0, 15); // January 15, 2025
    expect(formatDate(date2025)).toContain('2025');
  });
});

describe('truncateText', () => {
  it('returns original text if shorter than maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello');
    expect(truncateText('short', 100)).toBe('short');
  });

  it('returns original text if equal to maxLength', () => {
    expect(truncateText('hello', 5)).toBe('hello');
    expect(truncateText('exact', 5)).toBe('exact');
  });

  it('truncates and adds ellipsis if longer than maxLength', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
    expect(truncateText('this is a long string', 10)).toBe('this is a ...');
  });

  it('handles empty string', () => {
    expect(truncateText('', 5)).toBe('');
    expect(truncateText('', 0)).toBe('');
  });

  it('handles maxLength of 0', () => {
    expect(truncateText('hello', 0)).toBe('...');
  });

  it('handles single character truncation', () => {
    expect(truncateText('ab', 1)).toBe('a...');
  });
});
