import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { getProfileInfo } from '@/lib/therapy-profiles';
import { therapyService } from '@/services/TherapyService';
import { useTherapyStore } from '@/stores/therapyStore';
import type {
  Device,
  TherapyProfile,
  TherapyConfigProgress,
  TherapyConfigResult,
} from '@/types';
import {
  CheckCircle2,
  CircuitBoard,
  ClipboardCopy,
  Loader2,
  XCircle,
} from 'lucide-react';

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
  const { copyToClipboard } = useCopyToClipboard();
  const { addLog: storeAddLog, logs } = useTherapyStore();
  const [deviceProgress, setDeviceProgress] = useState<
    Map<string, TherapyConfigProgress>
  >(new Map());
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [configuredCount, setConfiguredCount] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const hasStartedRef = useRef(false);
  const cancelledRef = useRef(false);

  const profileInfo = getProfileInfo(profile);

  const addLog = (message: string) => {
    storeAddLog(`[${new Date().toLocaleTimeString()}] ${message}`);
  };

  const exportLogs = async () => {
    await copyToClipboard(logs.join('\n'), 'Configuration logs');
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

    addLog(`Starting configuration with ${profileInfo?.name} profile...`);
    addLog(`Configuring ${devices.length} device(s)`);

    const results: {
      device: Device;
      success: boolean;
      error?: string;
    }[] = [];

    for (const device of devices) {
      // Check cancellation before starting next device
      if (cancelledRef.current) {
        addLog(`Skipping ${device.label} — configuration cancelled`);
        break;
      }

      addLog(`Starting configuration for ${device.label}...`);
      try {
        await therapyService.configureProfile(device, profile, (progress) => {
          setDeviceProgress((prev) => {
            const next = new Map(prev);
            next.set(device.path, progress);
            return next;
          });
          onProgressUpdate(device.path, progress);

          // Log progress messages
          addLog(`${device.label}: ${progress.message}`);
        });

        addLog(`✓ Successfully configured ${device.label}`);
        results.push({ device, success: true });
        setConfiguredCount((c) => c + 1);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Configuration failed';

        setDeviceProgress((prev) => {
          const next = new Map(prev);
          next.set(device.path, {
            devicePath: device.path,
            stage: 'error',
            progress: 0,
            message: errorMessage,
          });
          return next;
        });

        addLog(`✗ Error configuring ${device.label}: ${errorMessage}`);
        setShowLogs(true); // Auto-expand logs on error

        results.push({
          device,
          success: false,
          error: errorMessage,
        });
      }
    }

    const allSuccess = results.every((r) => r.success);

    if (cancelledRef.current) {
      addLog('Configuration cancelled');
      return;
    }

    if (allSuccess) {
      addLog('All devices configured successfully!');
    } else {
      addLog('Configuration completed with errors');
    }

    onComplete({
      success: allSuccess,
      message: allSuccess
        ? `All devices configured with ${profileInfo?.name} profile`
        : 'Some devices failed to configure',
      deviceConfigs: results.map((r) => ({
        device: r.device,
        success: r.success,
        profile: r.success ? profile : undefined,
        error: r.error,
      })),
    });
  };

  const getStageIcon = (progress: TherapyConfigProgress | undefined) => {
    if (!progress) {
      return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }

    switch (progress.stage) {
      case 'complete':
        return <CheckCircle2 className="h-5 w-5 text-primary" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
    }
  };

  const overallProgress =
    devices.length > 0
      ? Math.round(
          Array.from(deviceProgress.values()).reduce(
            (sum, p) => sum + (p.stage === 'error' ? 0 : p.progress),
            0
          ) / devices.length
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Configuring Devices</h2>
        <p className="text-muted-foreground">
          Setting profile to{' '}
          <span className="font-medium text-primary">{profileInfo?.name}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall Progress</CardTitle>
          <CardDescription>
            {configuredCount} of {devices.length} device
            {devices.length !== 1 ? 's' : ''} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={overallProgress} className="h-2" />
          <p className="text-sm text-muted-foreground mt-2 text-center">
            {overallProgress}%
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {devices.map((device) => {
          const progress = deviceProgress.get(device.path);

          return (
            <Card
              key={device.path}
              className={
                progress?.stage === 'error'
                  ? 'border-destructive/50'
                  : progress?.stage === 'complete'
                  ? 'border-primary/50'
                  : ''
              }
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CircuitBoard className="h-5 w-5" />
                    <div>
                      <CardTitle className="text-base">{device.label}</CardTitle>
                      <CardDescription className="text-xs">
                        {device.path}
                      </CardDescription>
                    </div>
                  </div>
                  {getStageIcon(progress)}
                </div>
              </CardHeader>
              <CardContent>
                <Progress
                  value={progress?.progress ?? 0}
                  className={`h-2 ${
                    progress?.stage === 'error' ? '[&>div]:bg-destructive' : ''
                  }`}
                />
                <p
                  className={`text-sm mt-2 ${
                    progress?.stage === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }`}
                >
                  {progress?.message ?? 'Waiting...'}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Logs Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Configuration Log</CardTitle>
            <div className="flex items-center gap-2">
              {logs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportLogs}
                >
                  <ClipboardCopy className="h-4 w-4 mr-2" />
                  Copy Logs
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowLogs(!showLogs)}
              >
                {showLogs ? 'Hide' : 'Show'} Logs
              </Button>
            </div>
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            <div className="bg-muted rounded-md p-4 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
              {logs.map((log, index) => {
                const isError = log.includes('✗ Error');
                return (
                  <div
                    key={index}
                    className={isError ? 'text-destructive font-semibold' : 'text-muted-foreground'}
                  >
                    {log}
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Note:</span> Devices
            will restart automatically after configuration. Do not disconnect
            them until the process is complete.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
