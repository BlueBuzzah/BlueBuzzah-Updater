import { create } from 'zustand';
import type {
  Device,
  TherapyProfile,
  TherapyConfigProgress,
  TherapyConfigResult,
  TherapyState,
} from '@/types';

interface TherapyStore extends TherapyState {
  // Navigation
  setStep: (step: number) => void;
  nextStep: () => void;
  previousStep: () => void;

  // Profile selection
  selectProfile: (profile: TherapyProfile) => void;

  // Device management
  setDevices: (devices: Device[]) => void;
  toggleDevice: (device: Device) => void;

  // Progress tracking
  setProgress: (devicePath: string, progress: TherapyConfigProgress) => void;
  setResult: (result: TherapyConfigResult) => void;

  // Logging
  addLog: (message: string) => void;

  // Reset
  reset: () => void;
}

const initialState: TherapyState = {
  step: 0,
  selectedProfile: null,
  selectedDevices: [],
  progress: new Map(),
  result: null,
  logs: [],
};

export const useTherapyStore = create<TherapyStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ step: Math.max(0, Math.min(step, 2)) }),

  nextStep: () =>
    set((state) => ({ step: Math.min(state.step + 1, 2) })),

  previousStep: () =>
    set((state) => ({ step: Math.max(state.step - 1, 0) })),

  selectProfile: (profile) => set({ selectedProfile: profile }),

  setDevices: (devices) => set({ selectedDevices: devices }),

  toggleDevice: (device) =>
    set((state) => {
      const isSelected = state.selectedDevices.some(
        (d) => d.path === device.path
      );

      if (isSelected) {
        // Deselect: remove from array
        return {
          selectedDevices: state.selectedDevices.filter(
            (d) => d.path !== device.path
          ),
        };
      } else {
        // Select: add to array (max 2 devices)
        if (state.selectedDevices.length >= 2) {
          return state; // Don't add more than 2
        }
        return {
          selectedDevices: [...state.selectedDevices, device],
        };
      }
    }),

  setProgress: (devicePath, progress) =>
    set((state) => {
      const newProgress = new Map(state.progress);
      newProgress.set(devicePath, progress);
      return { progress: newProgress };
    }),

  setResult: (result) => set({ result }),

  addLog: (message) =>
    set((state) => ({ logs: [...state.logs, message] })),

  reset: () => set(initialState),
}));
