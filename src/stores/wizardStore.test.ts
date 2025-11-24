import { describe, it, expect, beforeEach } from 'vitest';
import { useWizardStore } from './wizardStore';
import type { FirmwareRelease, Device, UpdateProgress } from '@/types';

// Helper to create mock data
const createMockRelease = (overrides?: Partial<FirmwareRelease>): FirmwareRelease => ({
  version: '1.0.0',
  tagName: 'v1.0.0',
  releaseNotes: 'Test release notes',
  publishedAt: new Date('2024-01-15'),
  downloadUrl: 'https://example.com/firmware.zip',
  assets: [],
  ...overrides,
});

const createMockDevice = (overrides?: Partial<Device>): Device => ({
  path: '/Volumes/CIRCUITPY',
  label: 'CIRCUITPY',
  isCircuitPy: true,
  ...overrides,
});

const createMockProgress = (overrides?: Partial<UpdateProgress>): UpdateProgress => ({
  devicePath: '/Volumes/CIRCUITPY',
  stage: 'copying',
  progress: 50,
  message: 'Copying files...',
  ...overrides,
});

describe('wizardStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useWizardStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts at step 0', () => {
      expect(useWizardStore.getState().currentStep).toBe(0);
    });

    it('has no selected release', () => {
      expect(useWizardStore.getState().selectedRelease).toBeNull();
    });

    it('has empty selected devices', () => {
      expect(useWizardStore.getState().selectedDevices).toEqual([]);
    });

    it('has empty update progress map', () => {
      expect(useWizardStore.getState().updateProgress.size).toBe(0);
    });

    it('has null update result', () => {
      expect(useWizardStore.getState().updateResult).toBeNull();
    });

    it('has empty validation results map', () => {
      expect(useWizardStore.getState().validationResults.size).toBe(0);
    });
  });

  describe('setStep', () => {
    it('sets step to specified value', () => {
      useWizardStore.getState().setStep(2);
      expect(useWizardStore.getState().currentStep).toBe(2);
    });

    it('can set step to 0', () => {
      useWizardStore.getState().setStep(2);
      useWizardStore.getState().setStep(0);
      expect(useWizardStore.getState().currentStep).toBe(0);
    });

    it('can set step to 3', () => {
      useWizardStore.getState().setStep(3);
      expect(useWizardStore.getState().currentStep).toBe(3);
    });
  });

  describe('nextStep', () => {
    it('increments step from 0 to 1', () => {
      useWizardStore.getState().nextStep();
      expect(useWizardStore.getState().currentStep).toBe(1);
    });

    it('increments step from 1 to 2', () => {
      useWizardStore.getState().setStep(1);
      useWizardStore.getState().nextStep();
      expect(useWizardStore.getState().currentStep).toBe(2);
    });

    it('does not exceed step 3', () => {
      useWizardStore.getState().setStep(3);
      useWizardStore.getState().nextStep();
      expect(useWizardStore.getState().currentStep).toBe(3);
    });

    it('calling nextStep multiple times respects max', () => {
      for (let i = 0; i < 10; i++) {
        useWizardStore.getState().nextStep();
      }
      expect(useWizardStore.getState().currentStep).toBe(3);
    });
  });

  describe('previousStep', () => {
    it('decrements step from 1 to 0', () => {
      useWizardStore.getState().setStep(1);
      useWizardStore.getState().previousStep();
      expect(useWizardStore.getState().currentStep).toBe(0);
    });

    it('decrements step from 3 to 2', () => {
      useWizardStore.getState().setStep(3);
      useWizardStore.getState().previousStep();
      expect(useWizardStore.getState().currentStep).toBe(2);
    });

    it('does not go below 0', () => {
      useWizardStore.getState().previousStep();
      expect(useWizardStore.getState().currentStep).toBe(0);
    });

    it('calling previousStep multiple times respects min', () => {
      useWizardStore.getState().setStep(2);
      for (let i = 0; i < 10; i++) {
        useWizardStore.getState().previousStep();
      }
      expect(useWizardStore.getState().currentStep).toBe(0);
    });
  });

  describe('selectRelease', () => {
    it('sets selected release', () => {
      const release = createMockRelease();
      useWizardStore.getState().selectRelease(release);
      expect(useWizardStore.getState().selectedRelease).toEqual(release);
    });

    it('can update selected release', () => {
      const release1 = createMockRelease({ version: '1.0.0' });
      const release2 = createMockRelease({ version: '2.0.0' });

      useWizardStore.getState().selectRelease(release1);
      useWizardStore.getState().selectRelease(release2);

      expect(useWizardStore.getState().selectedRelease?.version).toBe('2.0.0');
    });
  });

  describe('setDevices', () => {
    it('sets selected devices', () => {
      const devices = [createMockDevice()];
      useWizardStore.getState().setDevices(devices);
      expect(useWizardStore.getState().selectedDevices).toEqual(devices);
    });

    it('can set multiple devices', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1', label: 'CIRCUITPY1' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2', label: 'CIRCUITPY2' }),
      ];
      useWizardStore.getState().setDevices(devices);
      expect(useWizardStore.getState().selectedDevices).toHaveLength(2);
    });

    it('can clear devices with empty array', () => {
      useWizardStore.getState().setDevices([createMockDevice()]);
      useWizardStore.getState().setDevices([]);
      expect(useWizardStore.getState().selectedDevices).toEqual([]);
    });
  });

  describe('updateDeviceRole', () => {
    it('updates role for specific device', () => {
      const device = createMockDevice();
      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().updateDeviceRole('/Volumes/CIRCUITPY', 'PRIMARY');

      const updatedDevice = useWizardStore.getState().selectedDevices[0];
      expect(updatedDevice.role).toBe('PRIMARY');
    });

    it('does not affect other devices', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2' }),
      ];
      useWizardStore.getState().setDevices(devices);
      useWizardStore.getState().updateDeviceRole('/Volumes/CIRCUITPY1', 'PRIMARY');

      const [device1, device2] = useWizardStore.getState().selectedDevices;
      expect(device1.role).toBe('PRIMARY');
      expect(device2.role).toBeUndefined();
    });

    it('can set SECONDARY role', () => {
      const device = createMockDevice();
      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().updateDeviceRole('/Volumes/CIRCUITPY', 'SECONDARY');

      const updatedDevice = useWizardStore.getState().selectedDevices[0];
      expect(updatedDevice.role).toBe('SECONDARY');
    });

    it('does nothing if device path not found', () => {
      const device = createMockDevice();
      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().updateDeviceRole('/Volumes/NONEXISTENT', 'PRIMARY');

      const updatedDevice = useWizardStore.getState().selectedDevices[0];
      expect(updatedDevice.role).toBeUndefined();
    });
  });

  describe('updateDeviceInfo', () => {
    it('updates path and label for device', () => {
      const device = createMockDevice();
      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().updateDeviceInfo(
        '/Volumes/CIRCUITPY',
        'BLUEBUZZAH',
        '/Volumes/BLUEBUZZAH'
      );

      const updatedDevice = useWizardStore.getState().selectedDevices[0];
      expect(updatedDevice.path).toBe('/Volumes/BLUEBUZZAH');
      expect(updatedDevice.label).toBe('BLUEBUZZAH');
    });

    it('updates progress map key when device path changes', () => {
      const device = createMockDevice();
      const progress = createMockProgress();

      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', progress);

      // Verify progress exists at old key
      expect(useWizardStore.getState().updateProgress.has('/Volumes/CIRCUITPY')).toBe(true);

      // Update device info
      useWizardStore.getState().updateDeviceInfo(
        '/Volumes/CIRCUITPY',
        'BLUEBUZZAH',
        '/Volumes/BLUEBUZZAH'
      );

      // Progress should now be at new key
      expect(useWizardStore.getState().updateProgress.has('/Volumes/BLUEBUZZAH')).toBe(true);
      expect(useWizardStore.getState().updateProgress.has('/Volumes/CIRCUITPY')).toBe(false);
    });

    it('updates devicePath in progress object', () => {
      const device = createMockDevice();
      const progress = createMockProgress();

      useWizardStore.getState().setDevices([device]);
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', progress);

      useWizardStore.getState().updateDeviceInfo(
        '/Volumes/CIRCUITPY',
        'BLUEBUZZAH',
        '/Volumes/BLUEBUZZAH'
      );

      const updatedProgress = useWizardStore.getState().updateProgress.get('/Volumes/BLUEBUZZAH');
      expect(updatedProgress?.devicePath).toBe('/Volumes/BLUEBUZZAH');
    });

    it('does not affect devices with different paths', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1', label: 'CIRCUITPY1' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2', label: 'CIRCUITPY2' }),
      ];
      useWizardStore.getState().setDevices(devices);

      useWizardStore.getState().updateDeviceInfo(
        '/Volumes/CIRCUITPY1',
        'BLUEBUZZAH',
        '/Volumes/BLUEBUZZAH'
      );

      const [device1, device2] = useWizardStore.getState().selectedDevices;
      expect(device1.path).toBe('/Volumes/BLUEBUZZAH');
      expect(device2.path).toBe('/Volumes/CIRCUITPY2');
    });
  });

  describe('setUpdateProgress', () => {
    it('adds progress entry to map', () => {
      const progress = createMockProgress();
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', progress);

      expect(useWizardStore.getState().updateProgress.get('/Volumes/CIRCUITPY')).toEqual(progress);
    });

    it('can update existing progress', () => {
      const progress1 = createMockProgress({ progress: 25 });
      const progress2 = createMockProgress({ progress: 75 });

      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', progress1);
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', progress2);

      expect(useWizardStore.getState().updateProgress.get('/Volumes/CIRCUITPY')?.progress).toBe(75);
    });

    it('can track multiple devices', () => {
      const progress1 = createMockProgress({ devicePath: '/Volumes/CIRCUITPY1' });
      const progress2 = createMockProgress({ devicePath: '/Volumes/CIRCUITPY2' });

      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY1', progress1);
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY2', progress2);

      expect(useWizardStore.getState().updateProgress.size).toBe(2);
    });
  });

  describe('setUpdateResult', () => {
    it('sets update result', () => {
      const result = {
        success: true,
        message: 'Update complete',
        deviceUpdates: [],
      };
      useWizardStore.getState().setUpdateResult(result);
      expect(useWizardStore.getState().updateResult).toEqual(result);
    });

    it('can set failure result', () => {
      const result = {
        success: false,
        message: 'Update failed',
        deviceUpdates: [],
      };
      useWizardStore.getState().setUpdateResult(result);
      expect(useWizardStore.getState().updateResult?.success).toBe(false);
    });
  });

  describe('setValidationResults', () => {
    it('sets validation results map', () => {
      const results = new Map();
      results.set('/Volumes/CIRCUITPY', {
        valid: true,
        errors: [],
        warnings: [],
      });

      useWizardStore.getState().setValidationResults(results);
      expect(useWizardStore.getState().validationResults.size).toBe(1);
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      // Modify state
      useWizardStore.getState().setStep(2);
      useWizardStore.getState().selectRelease(createMockRelease());
      useWizardStore.getState().setDevices([createMockDevice()]);
      useWizardStore.getState().setUpdateProgress('/Volumes/CIRCUITPY', createMockProgress());

      // Reset
      useWizardStore.getState().reset();

      // Verify initial state
      const state = useWizardStore.getState();
      expect(state.currentStep).toBe(0);
      expect(state.selectedRelease).toBeNull();
      expect(state.selectedDevices).toEqual([]);
      expect(state.updateProgress.size).toBe(0);
      expect(state.updateResult).toBeNull();
      expect(state.validationResults.size).toBe(0);
    });

    it('can be called multiple times', () => {
      useWizardStore.getState().setStep(2);
      useWizardStore.getState().reset();
      useWizardStore.getState().reset();
      expect(useWizardStore.getState().currentStep).toBe(0);
    });
  });
});
