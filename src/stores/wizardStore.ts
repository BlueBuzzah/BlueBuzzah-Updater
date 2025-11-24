import { create } from 'zustand';
import {
  FirmwareRelease,
  Device,
  UpdateProgress,
  UpdateResult,
  WizardState,
  ValidationResult,
} from '@/types';

interface WizardStore extends WizardState {
  // Actions
  setStep: (step: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  selectRelease: (release: FirmwareRelease) => void;
  setDevices: (devices: Device[]) => void;
  updateDeviceRole: (devicePath: string, role: 'PRIMARY' | 'SECONDARY') => void;
  setUpdateProgress: (devicePath: string, progress: UpdateProgress) => void;
  setUpdateResult: (result: UpdateResult) => void;
  setValidationResults: (results: Map<string, ValidationResult>) => void;
  reset: () => void;
}

const initialState: WizardState = {
  currentStep: 0,
  selectedRelease: null,
  selectedDevices: [],
  updateProgress: new Map(),
  updateResult: null,
  validationResults: new Map(),
};

export const useWizardStore = create<WizardStore>((set) => ({
  ...initialState,

  setStep: (step) => set({ currentStep: step }),

  nextStep: () =>
    set((state) => ({ currentStep: Math.min(state.currentStep + 1, 3) })),

  previousStep: () =>
    set((state) => ({ currentStep: Math.max(state.currentStep - 1, 0) })),

  selectRelease: (release) => set({ selectedRelease: release }),

  setDevices: (devices) => set({ selectedDevices: devices }),

  updateDeviceRole: (devicePath, role) =>
    set((state) => ({
      selectedDevices: state.selectedDevices.map((device) =>
        device.path === devicePath ? { ...device, role } : device
      ),
    })),

  setUpdateProgress: (devicePath, progress) =>
    set((state) => {
      const newProgress = new Map(state.updateProgress);
      newProgress.set(devicePath, progress);
      return { updateProgress: newProgress };
    }),

  setUpdateResult: (result) => set({ updateResult: result }),

  setValidationResults: (results) => set({ validationResults: results }),

  reset: () => set(initialState),
}));
