import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBusyCloseGuard } from './useBusyCloseGuard';
import { useWizardStore } from '@/stores/wizardStore';
import { useTherapyStore } from '@/stores/therapyStore';

type Handler = (e: { preventDefault: () => void }) => void;
let handler: Handler | undefined;
const destroy = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (h: Handler) => {
      handler = h;
      return Promise.resolve(() => {});
    },
    destroy: () => destroy(),
  }),
}));

describe('useBusyCloseGuard', () => {
  beforeEach(() => {
    handler = undefined;
    useWizardStore.getState().reset();
    useTherapyStore.getState().reset();
  });

  it('blocks closing and opens the prompt while a flash runs', () => {
    useWizardStore.setState({ currentStep: 2, updateResult: null });
    const { result } = renderHook(() => useBusyCloseGuard());
    const preventDefault = vi.fn();
    act(() => handler?.({ preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.promptOpen).toBe(true);
  });

  it('lets the window close when nothing runs', () => {
    const { result } = renderHook(() => useBusyCloseGuard());
    const preventDefault = vi.fn();
    act(() => handler?.({ preventDefault }));
    expect(preventDefault).not.toHaveBeenCalled();
    expect(result.current.promptOpen).toBe(false);
  });

  it('close anyway destroys the window', async () => {
    useTherapyStore.setState({ step: 2, result: null });
    const { result } = renderHook(() => useBusyCloseGuard());
    await act(() => result.current.closeAnyway());
    expect(destroy).toHaveBeenCalled();
  });
});
