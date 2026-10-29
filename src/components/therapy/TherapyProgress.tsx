import { useEffect, useRef, useState } from 'react';
import { Clock, type LucideIcon } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { DeviceCard } from '@/components/ui/device-card';
import { LogPane } from '@/components/ui/log-pane';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatusBadge, type Tone } from '@/components/ui/status-badge';
import { BOARD_NAME } from '@/components/wizard/DeviceSelection';
import { summarizeDeviceError } from '@/lib/error-messages';
import { logLine, type LogLevel } from '@/lib/log';
import { getProfileInfo } from '@/lib/therapy-profiles';
import { therapyService } from '@/services/TherapyService';
import { useTherapyStore } from '@/stores/therapyStore';
import type { Device, TherapyConfigProgress, TherapyConfigResult, TherapyProfile, ProfileConfigOutcome } from '@/types';

interface TherapyProgressProps {
  profile: TherapyProfile;
  devices: Device[];
  onComplete: (result: TherapyConfigResult) => void;
  onProgressUpdate: (devicePath: string, progress: TherapyConfigProgress) => void;
}

export function TherapyProgress({
  profile,
  devices,
  onComplete,
  onProgressUpdate,
}: TherapyProgressProps) {
  const { addLog: storeAddLog, logs } = useTherapyStore();
  const [deviceProgress, setDeviceProgress] = useState<
    Map<string, TherapyConfigProgress>
  >(new Map());
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [configuredCount, setConfiguredCount] = useState(0);
  const hasStartedRef = useRef(false);
  const cancelledRef = useRef(false);

  const profileInfo = getProfileInfo(profile);

  const addLog = (level: LogLevel, message: string) => {
    storeAddLog(logLine(level, `[${new Date().toLocaleTimeString()}] ${message}`));
  };


  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startConfiguration();
  }, []);

  const startConfiguration = async () => {
    if (isConfiguring) return;
    setIsConfiguring(true);

    addLog('INFO', `Starting configuration with ${profileInfo?.name} profile...`);
    addLog('INFO', `Configuring ${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`);

    const results: {
      device: Device;
      success: boolean;
      error?: string;
      outcome?: ProfileConfigOutcome;
    }[] = [];

    for (const device of devices) {
      // Check cancellation before starting next device
      if (cancelledRef.current) {
        addLog('WARN', `Skipping ${device.label} — configuration cancelled`);
        break;
      }

      addLog('INFO', `Starting configuration for ${device.label}...`);
      try {
        const outcome = await therapyService.configureProfile(
          device,
          profile,
          (progress) => {
            setDeviceProgress((prev) => {
              const next = new Map(prev);
              next.set(device.path, progress);
              return next;
            });
            onProgressUpdate(device.path, progress);

            // Terminal stages carry the outcome message, which the switch below
            // logs with its own status marker — logging it here too printed
            // every outcome twice.
            if (progress.stage !== 'complete' && progress.stage !== 'partial') {
              addLog('INFO', `${device.label}: ${progress.message}`);
            }
          }
        );

        switch (outcome.status) {
          case 'success_secondary':
            // The backend's own message, never a fixed line: this status comes
            // from two different points — the preflight role check, before
            // anything is changed, and after PROFILE_LOAD has landed. Only the
            // backend knows which, so hardcoding "profile loaded" here claims a
            // change that may never have happened.
            addLog('INFO', `${device.label}: ${outcome.message}`);
            break;
          case 'partial':
            addLog('WARN', `${device.label}: ${outcome.message}`);
            if (outcome.detail) {
              addLog('WARN', `   Detail: ${outcome.detail.replace(/\n/g, '\n   ')}`);
            }
            break;
          default:
            addLog('INFO', `Successfully configured ${device.label}`);
        }

        results.push({ device, success: true, outcome });
        setConfiguredCount((c) => c + 1);
      } catch (error) {
        // Tauri rejects an invoke with the command's Err payload verbatim — a
        // plain string for `Result<_, String>`, never an Error. Testing only
        // for Error therefore throws away every backend diagnostic and leaves
        // the user with an unexplained failure.
        const errorDetail =
          error instanceof Error
            ? error.message
            : typeof error === 'string' && error.trim()
            ? error
            : 'Configuration failed';
        const errorSummary = summarizeDeviceError(errorDetail);

        setDeviceProgress((prev) => {
          const next = new Map(prev);
          next.set(device.path, {
            devicePath: device.path,
            stage: 'error',
            progress: 0,
            message: errorSummary,
          });
          return next;
        });

        // Card gets the one-line summary; the log keeps every byte the device
        // sent back, so it stays diagnosable and copyable after the fact.
        addLog('ERROR', `Error configuring ${device.label}: ${errorSummary}`);
        if (errorDetail !== errorSummary) {
          addLog('ERROR', `   Detail: ${errorDetail.replace(/\n/g, '\n   ')}`);
        }

        results.push({
          device,
          success: false,
          error: errorSummary,
        });
      }
    }

    const allSuccess = results.every(
      (r) => r.success && r.outcome?.status !== 'partial'
    );
    const allSecondary =
      results.length > 0 &&
      results.every((r) => r.outcome?.status === 'success_secondary');

    if (cancelledRef.current) {
      addLog('WARN', 'Configuration cancelled');
      return;
    }

    if (allSuccess) {
      addLog('INFO', 'All devices configured successfully');
    } else {
      addLog('ERROR', 'Configuration completed with errors');
    }

    onComplete({
      success: allSuccess,
      message: allSuccess
        ? allSecondary
          ? 'Custom parameters were not applied — no glove answered as primary.'
          : `All devices configured with ${profileInfo?.name} profile`
        : 'Some devices failed to configure',
      deviceConfigs: results.map((r) => ({
        device: r.device,
        success: r.success,
        profile: r.success ? profile : undefined,
        error: r.error,
        outcome: r.outcome,
      })),
    });
  };

  const plural = devices.length > 1;
  return (
    <div className="grid max-w-content gap-10">
      <Banner tone="warning" announce title={`Keep the ${plural ? 'devices' : 'device'} plugged in until this finishes.`}>
        They restart on their own when setup is done.
      </Banner>
      <ProgressBar
        label="Overall progress"
        value={devices.length ? (configuredCount / devices.length) * 100 : 0}
        detail={<span className="body tabular-nums">{`Setting up ${configuredCount} of ${devices.length} ${plural ? 'devices' : 'device'}`}</span>}
      />
      <ul className="grid gap-6 sm:grid-cols-2">
        {devices.map((device) => {
          const progress = deviceProgress.get(device.path);
          const state = configState(progress);
          return (
            <li key={device.path} className="grid content-start gap-4">
              <DeviceCard
                name={BOARD_NAME[device.board]}
                port={device.path}
                status={<StatusBadge tone={state.tone} icon={state.icon}>{state.word}</StatusBadge>}
                statusLabel={state.word}
              />
              <ProgressBar
                label={stageLabel(progress?.stage)}
                value={progress?.progress ?? 0}
                tone={state.tone === 'danger' ? 'danger' : undefined}
                detail={progress?.message ? <span className={progress.stage === 'error' ? 'code-s' : undefined}>{progress.message}</span> : undefined}
              />
              {(progress?.stage === 'error' || progress?.stage === 'partial') && (
                <p className="body-s text-ink-muted">Full device output is in the log below.</p>
              )}
            </li>
          );
        })}
      </ul>
      <LogPane lines={logs} fileName="bluebuzzah-updater-setup-log.txt" />
    </div>
  );
}

/** Plain words for each setup step (Copy for approval: Configure progress). */
function stageLabel(stage?: TherapyConfigProgress['stage']): string {
  switch (stage) {
    case undefined:
      return 'Waiting';
    case 'connecting':
      return 'Connecting';
    case 'sending':
      return 'Sending settings';
    case 'rebooting':
      return 'Restarting';
    case 'complete':
      return 'Finished';
    case 'partial':
      return 'Partly done';
    case 'error':
      return 'Stopped by an error';
  }
}

function configState(progress?: TherapyConfigProgress): { tone: Tone; word: string; icon?: LucideIcon } {
  switch (progress?.stage) {
    case undefined:
      return { tone: 'neutral', word: 'Waiting' };
    case 'complete':
      return { tone: 'success', word: 'Done' };
    case 'partial':
      return { tone: 'warning', word: 'Partly done' };
    case 'error':
      return { tone: 'danger', word: 'Failed' };
    default:
      return { tone: 'brand', word: 'Setting up', icon: Clock };
  }
}
