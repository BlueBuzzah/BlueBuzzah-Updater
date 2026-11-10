import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useIsBusy } from './busy';
import { useLogsStore } from './logsStore';
import { useTherapyStore } from './therapyStore';
import { useWizardStore } from './wizardStore';

describe('useIsBusy', () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
    useTherapyStore.getState().reset();
    useLogsStore.getState().reset();
  });

  it('is idle when nothing runs', () => {
    expect(renderHook(() => useIsBusy()).result.current).toEqual({ busy: false, kind: null });
  });

  it('returns monitor only while logs stream', () => {
    useLogsStore.setState({ phase: 'streaming' });
    expect(renderHook(() => useIsBusy()).result.current).toEqual({ busy: true, kind: 'monitor' });
    useLogsStore.setState({ phase: 'stopped' });
    expect(renderHook(() => useIsBusy()).result.current).toEqual({ busy: false, kind: null });
  });

  it('ranks a flash, then a configure write, above viewing', () => {
    useLogsStore.setState({ phase: 'streaming' });
    useTherapyStore.setState({ step: 2, result: null });
    expect(renderHook(() => useIsBusy()).result.current.kind).toBe('configure');
    useWizardStore.setState({ currentStep: 2, updateResult: null });
    expect(renderHook(() => useIsBusy()).result.current.kind).toBe('flash');
  });
});
