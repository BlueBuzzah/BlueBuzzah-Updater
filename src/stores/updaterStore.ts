import { create } from 'zustand';
import { UpdaterState, AppUpdateInfo, AppUpdateProgress } from '@/types';

interface UpdaterStore extends UpdaterState {
  // Actions
  setChecking: (isChecking: boolean) => void;
  setUpdateAvailable: (info: AppUpdateInfo | null) => void;
  setProgress: (progress: AppUpdateProgress | null) => void;
  setError: (error: string | null) => void;
  dismiss: () => void;
  reset: () => void;
}

const initialState: UpdaterState = {
  isChecking: false,
  updateAvailable: false,
  updateInfo: null,
  progress: null,
  error: null,
  dismissed: false,
};

export const useUpdaterStore = create<UpdaterStore>((set) => ({
  ...initialState,

  setChecking: (isChecking) => set({ isChecking }),

  setUpdateAvailable: (info) =>
    set({
      updateAvailable: info !== null,
      updateInfo: info,
      isChecking: false,
    }),

  setProgress: (progress) => set({ progress }),

  setError: (error) =>
    set({
      error,
      isChecking: false,
    }),

  dismiss: () => set({ dismissed: true }),

  reset: () => set(initialState),
}));
