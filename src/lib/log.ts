export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** Log lines carry a level word so they never rely on color (updater.md Logs). */
export function logLine(level: LogLevel, message: string): string {
  return `${level}  ${message}`;
}
