import { UpdaterErrorInfo, UpdaterErrorStage } from '@/types';

/**
 * Extracts detailed error information from Tauri updater errors.
 * Captures message, cause, and stack trace for debugging.
 */
export function extractUpdaterError(
  error: unknown,
  stage: UpdaterErrorStage
): UpdaterErrorInfo {
  let message: string;
  let details: string;

  if (error instanceof Error) {
    message = error.message || 'Unknown error';

    const parts: string[] = [];

    // Primary error message
    parts.push(`Error: ${error.message}`);

    // Error name if not generic
    if (error.name && error.name !== 'Error') {
      parts.push(`Type: ${error.name}`);
    }

    // Cause chain (Tauri errors often have nested causes)
    // Use 'in' check for ES2022+ cause property compatibility
    if ('cause' in error && error.cause) {
      parts.push(`Cause: ${extractCause(error.cause)}`);
    }

    // Stack trace (first 5 lines for context)
    if (error.stack) {
      const stackLines = error.stack
        .split('\n')
        .slice(1, 6)
        .map((line) => line.trim())
        .join('\n');
      parts.push(`Stack:\n${stackLines}`);
    }

    details = parts.join('\n\n');
  } else if (typeof error === 'string') {
    message = error;
    details = error;
  } else if (error && typeof error === 'object') {
    // Handle object errors (some Tauri errors come as plain objects)
    try {
      details = JSON.stringify(error, null, 2);
      message =
        (error as Record<string, unknown>).message?.toString() ||
        (error as Record<string, unknown>).error?.toString() ||
        'Update error';
    } catch {
      message = 'Update error';
      details = String(error);
    }
  } else {
    message = 'Unknown error';
    details = String(error) || 'No error details available';
  }

  return {
    message,
    details,
    stage,
  };
}

/**
 * Recursively extracts cause chain from nested errors.
 */
function extractCause(cause: unknown, depth = 0): string {
  if (depth > 3) return '(nested causes truncated)';

  if (cause instanceof Error) {
    const msg = cause.message;
    // Use 'in' check for ES2022+ cause property compatibility
    if ('cause' in cause && cause.cause) {
      return `${msg}\n  → ${extractCause(cause.cause, depth + 1)}`;
    }
    return msg;
  }

  if (typeof cause === 'string') {
    return cause;
  }

  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/**
 * User-friendly stage descriptions for error display.
 */
export function getStageDescription(stage: UpdaterErrorStage): string {
  switch (stage) {
    case 'check':
      return 'checking for updates';
    case 'download':
      return 'downloading update';
    case 'install':
      return 'installing update';
    case 'relaunch':
      return 'relaunching application';
    default:
      return 'updating';
  }
}
