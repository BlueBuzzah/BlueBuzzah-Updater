import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Square } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceCard } from '@/components/ui/device-card';
import { LogPane } from '@/components/ui/log-pane';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusBadge, type Tone } from '@/components/ui/status-badge';
import { formatValidationErrors } from '@/lib/error-messages';
import { logLine, type LogLevel } from '@/lib/log';
import { deviceService } from '@/services/DeviceService';
import { firmwareService } from '@/services/FirmwareService';
import { useWizardStore } from '@/stores/wizardStore';
import type { Device, DeviceUpdateResult, FirmwareRelease, UpdateProgress, UpdateResult, UpdateStage } from '@/types';
import { BOARD_NAME } from './DeviceSelection';
import { FlashOutcome } from './FlashOutcome';

type RunStage = 'validating' | 'downloading' | 'installing' | 'complete';

/** Plain words for each step (Copy for approval: Firmware flashing). */
export function stageLabel(stage: UpdateStage | RunStage): string {
  switch (stage) {
    case 'validating':
      return 'Checking devices';
    case 'downloading':
      return 'Downloading firmware';
    case 'preparing':
    case 'copying':
      return 'Getting the device ready';
    case 'installing':
      return 'Writing firmware';
    case 'configuring':
      return 'Setting the role';
    case 'complete':
      return 'Finished';
    case 'error':
      return 'Stopped by an error';
    case 'cancelled':
      return 'Stopped';
  }
}

function deviceState(progress?: UpdateProgress): { tone: Tone; word: string } {
  switch (progress?.stage) {
    case undefined:
      return { tone: 'neutral', word: 'Waiting' };
    case 'complete':
      return { tone: 'success', word: 'Done' };
    case 'error':
      return { tone: 'danger', word: 'Failed' };
    case 'cancelled':
      return { tone: 'warning', word: 'Stopped' };
    default:
      return { tone: 'brand', word: 'Flashing' };
  }
}

interface InstallationProgressProps {
  release: FirmwareRelease;
  devices: Device[];
  onComplete: (result: UpdateResult) => void;
  onProgressUpdate: (devicePath: string, progress: UpdateProgress) => void;
}

export function InstallationProgress({ release, devices, onComplete, onProgressUpdate }: InstallationProgressProps) {
  const { updateDeviceInfo, addLog: storeAddLog, logs, reset, setUpdateResult } = useWizardStore();
  const [stage, setStage] = useState<RunStage>('validating');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deviceProgress, setDeviceProgress] = useState<Map<string, UpdateProgress>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DeviceUpdateResult[]>([]);
  const [updatedDevices, setUpdatedDevices] = useState<Device[]>(devices);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const hasStartedRef = useRef(false);
  const cancelledRef = useRef(false);
  // Each run gets an id; a stopped or replaced run must not report afterwards.
  const runIdRef = useRef(0);
  const completedDevices = useRef<Set<string>>(new Set());
  const devicePathMap = useRef<Map<string, { path: string; label: string }>>(new Map());
  const deviceResults = useRef<DeviceUpdateResult[]>([]);

  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startInstallation();
    return () => {
      // Only cancel the Rust-side DFU operation on unmount.
      deviceService.cancelFlash().catch(() => {});
    };
  }, []);

  const addLog = (level: LogLevel, message: string) => {
    storeAddLog(logLine(level, `[${new Date().toLocaleTimeString()}] ${message}`));
    const lower = message.toLowerCase();
    const isRetry =
      (lower.includes('retry') && (lower.includes('/3') || lower.includes('attempt'))) ||
      lower.includes('retrying') ||
      lower.includes('recovered after');
    if (isRetry) setRetryCount((n) => n + 1);
  };

  const handleRetry = () => {
    const retryDevices = updatedDevices.filter((d) => !completedDevices.current.has(d.path));
    setError(null);
    setResults([]);
    setStage('validating');
    setDownloadProgress(0);
    setDeviceProgress((prev) => {
      const next = new Map(prev);
      for (const d of retryDevices) next.delete(d.path);
      return next;
    });
    setRetryCount(0);
    setIsCancelling(false);
    cancelledRef.current = false;
    deviceResults.current = deviceResults.current.filter((r) => completedDevices.current.has(r.device.path));
    // The run is live again: clearing the result turns the run guards back on (nav lock, close guard, update hold).
    setUpdateResult(null);
    addLog('INFO', '--- Retrying failed devices ---');
    startInstallation(retryDevices);
  };

  const confirmStop = async () => {
    setShowStopConfirm(false);
    setIsCancelling(true);
    cancelledRef.current = true;
    addLog('WARN', 'Cancellation requested - stopping installation...');
    runIdRef.current += 1; // the stopped run's late results are ignored
    try {
      await deviceService.cancelFlash();
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
    // End the run now so the person isn't left on a dead progress view.
    fail(
      'Installation cancelled',
      updatedDevices.map((d) =>
        completedDevices.current.has(d.path) ? { device: d, success: true } : { device: d, success: false, error: 'Installation cancelled' }
      )
    );
  };

  const fail = (message: string, outcome: DeviceUpdateResult[]) => {
    setError(message);
    setResults(outcome);
    onComplete({ success: false, message, deviceUpdates: outcome });
  };

  const startInstallation = async (devicesToFlash?: Device[]) => {
    const targetDevices = devicesToFlash ?? updatedDevices;
    const runId = ++runIdRef.current;
    const stale = () => runId !== runIdRef.current;
    try {
      // Stage 0: validate devices
      addLog('INFO', 'Validating devices before installation...');
      setStage('validating');
      const validationResults = await deviceService.validateDevices(targetDevices);
      const validationErrors: string[] = [];
      validationResults.forEach((result, devicePath) => {
        const label = targetDevices.find((d) => d.path === devicePath)?.label || devicePath;
        if (!result.valid) {
          addLog('ERROR', `Validation failed for ${label}`);
          result.errors.forEach((err) => {
            addLog('ERROR', `  - ${err}`);
            validationErrors.push(`${label}: ${err}`);
          });
        } else if (result.warnings.length > 0) {
          addLog('WARN', `Warnings for ${label}`);
          result.warnings.forEach((warn) => addLog('WARN', `  - ${warn}`));
        } else {
          addLog('INFO', `${label} passed validation`);
        }
      });
      if (validationErrors.length > 0) {
        throw new Error(`Device validation failed:\n${formatValidationErrors(validationErrors)}`);
      }
      addLog('INFO', 'All devices passed validation');

      // Batch flashing is single-board only — selection UI enforces this;
      // guard defensively so a mixed batch can never reach the flashers.
      const boards = [...new Set(targetDevices.map((d) => d.board))];
      if (boards.length > 1) throw new Error('All devices in one update run must be the same hardware version.');
      const board = boards[0];

      // Stage 1: download firmware for the selected board
      addLog('INFO', `Downloading ${board === 'esp32s3' ? 'v3' : 'v2'} firmware for version ${release.version}...`);
      setStage('downloading');
      setDownloadProgress(0);
      const firmware = await firmwareService.downloadFirmware(release, board);
      setDownloadProgress(100);
      addLog('INFO', 'Firmware download complete');

      // Stage 2: install on devices
      setStage('installing');
      addLog('INFO', `Installing firmware on ${targetDevices.length} ${targetDevices.length === 1 ? 'device' : 'devices'}...`);
      for (const device of targetDevices) {
        if (cancelledRef.current) {
          addLog('WARN', `Skipping ${device.label} — installation cancelled`);
          break;
        }
        // Track current path/label locally; never mutate the original device object.
        let currentPath = device.path;
        let currentLabel = device.label;
        addLog('INFO', `Starting update for ${currentLabel} (${device.role})...`);
        try {
          await deviceService.deployFirmware(
            device,
            firmware,
            (progress) => {
              if (progress.newDeviceLabel && progress.newDevicePath) {
                const originalPath = device.path;
                devicePathMap.current.set(originalPath, { path: progress.newDevicePath, label: progress.newDeviceLabel });
                currentPath = progress.newDevicePath;
                currentLabel = progress.newDeviceLabel;
                updateDeviceInfo(originalPath, progress.newDeviceLabel, progress.newDevicePath);
                setUpdatedDevices((prev) =>
                  prev.map((d) => (d.path === originalPath ? { ...d, label: progress.newDeviceLabel!, path: progress.newDevicePath! } : d))
                );
                setDeviceProgress((prev) => {
                  const next = new Map(prev);
                  next.delete(originalPath);
                  next.set(progress.newDevicePath!, progress);
                  return next;
                });
                addLog('INFO', `Device reconnected as ${progress.newDeviceLabel}`);
              } else {
                setDeviceProgress((prev) => new Map(prev).set(currentPath, progress));
              }
              onProgressUpdate(currentPath, progress);
            },
            (logMessage) => addLog('INFO', `${currentLabel}: ${logMessage}`)
          );
          completedDevices.current.add(device.path);
          if (currentPath !== device.path) completedDevices.current.add(currentPath);
          addLog('INFO', `Successfully updated ${currentLabel}`);
          deviceResults.current.push({ device, success: true });
        } catch (deviceErr) {
          const message =
            typeof deviceErr === 'string'
              ? deviceErr
              : deviceErr instanceof Error
                ? deviceErr.message
                : JSON.stringify(deviceErr) || 'Unknown error occurred';
          addLog('ERROR', `Error updating ${currentLabel}: ${message}`);
          deviceResults.current.push({ device, success: false, error: message });
          // Continue to the next device instead of aborting
        }
      }

      // Stage 3: complete (a stopped run already reported)
      if (!cancelledRef.current && !stale()) {
        const overallSuccess = deviceResults.current.every((r) => r.success);
        setStage('complete');
        if (overallSuccess) {
          addLog('INFO', 'All devices updated successfully');
          setResults(deviceResults.current);
          onComplete({ success: true, message: 'All devices updated successfully', deviceUpdates: deviceResults.current });
        } else {
          const okCount = deviceResults.current.filter((r) => r.success).length;
          const failCount = deviceResults.current.length - okCount;
          addLog('ERROR', `Installation completed: ${okCount} succeeded, ${failCount} failed`);
          fail('Some devices failed to update', deviceResults.current);
        }
      }
    } catch (err) {
      if (stale()) return;
      const message =
        typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err) || 'Unknown error occurred';
      addLog('ERROR', `Error: ${message}`);
      // Keep devices that already succeeded (e.g. on a retry) as successes.
      fail(message, [
        ...deviceResults.current.filter((r) => r.success),
        ...targetDevices.map((d) => ({ device: d, success: false, error: message })),
      ]);
    }
  };

  const overall = (() => {
    if (stage === 'validating') return 0;
    if (stage === 'downloading') return Math.min(downloadProgress * 0.2, 20);
    if (stage === 'installing') {
      const sum = Array.from(deviceProgress.values()).reduce((acc, p) => acc + Math.min(p.progress, 100), 0);
      const avg = devices.length > 0 ? sum / devices.length : 0;
      return Math.min(20 + avg * 0.8, 100);
    }
    return 100;
  })();
  const activeStage = stage === 'installing' ? [...deviceProgress.values()].find((p) => p.stage !== 'complete')?.stage ?? 'installing' : stage;
  const pct = Math.round(overall);

  if (error) {
    return (
      <div className="grid max-w-content gap-10">
        <FlashOutcome
          version={release.version}
          devices={updatedDevices}
          results={results}
          error={results.some((r) => r.success) ? null : error}
          logText={logs.join('\n')}
          actions={
            <>
              <Button icon={RotateCcw} guardRepeat onClick={handleRetry}>
                Try Again
              </Button>
              <Button variant="quiet" onClick={reset}>
                Start Over
              </Button>
            </>
          }
        />
        {/* Every failure keeps the full log one click away for troubleshooting. */}
        <LogPane lines={logs} />
      </div>
    );
  }

  const plural = devices.length > 1;
  return (
    <div className="grid max-w-content gap-10">
      <Banner tone="warning" announce title={`Keep the ${plural ? 'devices' : 'device'} plugged in until this finishes.`}>
        Unplugging now can leave the device unable to start.
      </Banner>
      <div className="grid gap-3">
        <ProgressBar label="Overall progress" value={overall} detail={<span className="body">{`${stageLabel(activeStage)} — ${pct}%`}</span>} />
        {retryCount > 0 && <p className="body-s tabular-nums text-ink-muted">Retried {retryCount} times</p>}
      </div>
      <ul className="grid gap-6 sm:grid-cols-2">
        {updatedDevices.map((device) => {
          const progress = deviceProgress.get(device.path);
          const state = deviceState(progress);
          const name = device.role === 'SECONDARY' ? 'Secondary device' : 'Primary device';
          return (
            <li key={device.path} className="grid content-start gap-4">
              <DeviceCard
                name={BOARD_NAME[device.board]}
                role={device.role}
                port={device.path}
                status={<StatusBadge tone={state.tone}>{state.word}</StatusBadge>}
                statusLabel={state.word}
              />
              <ProgressBar label={name} value={progress?.progress ?? 0} detail={progress?.message} tone={state.tone === 'danger' ? 'danger' : undefined} />
            </li>
          );
        })}
      </ul>
      {stage !== 'complete' && (
        <div>
          <Button variant="quiet" icon={Square} guardRepeat disabled={isCancelling} onClick={() => setShowStopConfirm(true)}>
            Stop
          </Button>
        </div>
      )}
      <LogPane lines={logs} />
      <ConfirmDialog
        open={showStopConfirm}
        onOpenChange={setShowStopConfirm}
        title="Stop the Flash?"
        cancelLabel="Keep Flashing"
        confirmLabel="Stop Flash"
        confirmGuard
        onConfirm={confirmStop}
      >
        The device may not start until you flash it again. To recover, plug it back in and flash again.
      </ConfirmDialog>
    </div>
  );
}
