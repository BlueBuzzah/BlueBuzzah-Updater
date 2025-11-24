import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Channel class for Tauri
class MockChannel<T = unknown> {
  onmessage: ((message: T) => void) | null = null;
}

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: MockChannel,
}));

// Mock Tauri event system
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock fetch for GitHub API calls
global.fetch = vi.fn();

// Mock console methods to prevent stderr noise and enable assertions
// Apply mock implementations immediately to catch all console calls
export const mockConsole = {
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
};

// Clean up mocks between tests and re-apply console mocks
beforeEach(() => {
  vi.resetAllMocks();
  // Re-apply console mocks after reset (resetAllMocks clears implementations)
  mockConsole.error.mockImplementation(() => {});
  mockConsole.warn.mockImplementation(() => {});
  mockConsole.log.mockImplementation(() => {});
});
