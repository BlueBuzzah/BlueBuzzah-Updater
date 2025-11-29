import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  CircuitBoard,
  Download,
  Copy,
  Settings,
  ClipboardCopy,
  RotateCcw,
  Usb,
} from 'lucide-react';
import { Device, FirmwareRelease, UpdateProgress } from '@/types';
import { firmwareService } from '@/services/FirmwareService';
import { deviceService } from '@/services/DeviceService';
import { useWizardStore } from '@/stores/wizardStore';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getErrorGuidance, formatValidationErrors } from '@/lib/error-messages';
import { useToast } from '@/components/ui/use-toast';

interface InstallationProgressProps {
  release: FirmwareRelease;
  devices: Device[];
  onComplete: (success: boolean) => void;
  onProgressUpdate: (devicePath: string, progress: UpdateProgress) => void;
}

export function InstallationProgress({
  release,
  devices,
  onComplete,
  onProgressUpdate,
}: InstallationProgressProps) {
  const { reset, updateDeviceInfo } = useWizardStore();
  const { toast } = useToast();
  const [stage, setStage] = useState<'validating' | 'downloading' | 'installing' | 'complete'>(
    'validating'
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deviceProgress, setDeviceProgress] = useState<
    Map<string, UpdateProgress>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [updatedDevices, setUpdatedDevices] = useState<Device[]>(devices);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startInstallation();
  }, []);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const exportLogs = () => {
    const logsText = logs.join('\n');
    navigator.clipboard.writeText(logsText);
    toast({
      title: 'Logs copied',
      description: 'Installation logs have been copied to clipboard',
    });
  };

  const handleStartOver = () => {
    reset();
  };

  const startInstallation = async () => {
    try {
      // Stage 0: Validate devices
      addLog('Validating devices before installation...');
      setStage('validating');

      const validationResults = await deviceService.validateDevices(devices);
      let hasValidationErrors = false;
      const validationErrors: string[] = [];

      validationResults.forEach((result, devicePath) => {
        const device = devices.find((d) => d.path === devicePath);
        const deviceLabel = device?.label || devicePath;

        if (!result.valid) {
          hasValidationErrors = true;
          addLog(`✗ Validation failed for ${deviceLabel}`);
          result.errors.forEach((err) => {
            addLog(`  - ${err}`);
            validationErrors.push(`${deviceLabel}: ${err}`);
          });
        } else if (result.warnings.length > 0) {
          addLog(`⚠ Warnings for ${deviceLabel}`);
          result.warnings.forEach((warn) => addLog(`  - ${warn}`));
        } else {
          addLog(`✓ ${deviceLabel} passed validation`);
        }
      });

      if (hasValidationErrors) {
        throw new Error(
          `Device validation failed:\n${formatValidationErrors(validationErrors)}`
        );
      }

      addLog('All devices passed validation');

      // Stage 1: Download firmware
      addLog(`Starting firmware download for version ${release.version}...`);
      setStage('downloading');
      setDownloadProgress(0);

      const firmware = await firmwareService.downloadFirmware(release);
      setDownloadProgress(100);
      addLog('Firmware download complete');

      // Stage 2: Install on devices
      setStage('installing');
      addLog(`Installing firmware on ${devices.length} device(s)...`);

      for (const device of updatedDevices) {
        addLog(`Starting update for ${device.label} (${device.role})...`);
        let lastLoggedMessage: string | null = null;

        await deviceService.deployFirmware(device, firmware, (progress) => {
          // Check if device info was updated (volume renamed)
          if (progress.newDeviceLabel && progress.newDevicePath) {
            // Update wizard store with new device info
            updateDeviceInfo(device.path, progress.newDeviceLabel, progress.newDevicePath);

            // Update local device references
            setUpdatedDevices((prev) =>
              prev.map((d) =>
                d.path === device.path
                  ? { ...d, label: progress.newDeviceLabel!, path: progress.newDevicePath! }
                  : d
              )
            );

            // Update deviceProgress map with new path as key
            setDeviceProgress((prev) => {
              const next = new Map(prev);
              const oldProgress = next.get(device.path);
              if (oldProgress) {
                next.delete(device.path);
                next.set(progress.newDevicePath!, progress);
              } else {
                next.set(progress.newDevicePath!, progress);
              }
              return next;
            });

            // Update device reference for subsequent callbacks
            device.path = progress.newDevicePath!;
            device.label = progress.newDeviceLabel!;

            addLog(`✓ Volume renamed to ${progress.newDeviceLabel}`);
          } else {
            setDeviceProgress((prev) => {
              const next = new Map(prev);
              next.set(device.path, progress);
              return next;
            });
          }

          onProgressUpdate(device.path, progress);

          // Log unique messages from DFU backend (prevents duplicate logs)
          if (progress.message && progress.message !== lastLoggedMessage) {
            // Skip noisy upload percentage messages (progress bar shows this)
            if (!progress.message.startsWith('Uploading firmware...')) {
              if (progress.stage === 'complete') {
                addLog(`✓ ${device.label}: ${progress.message}`);
              } else {
                addLog(`${device.label}: ${progress.message}`);
              }
            }
            lastLoggedMessage = progress.message;
          }
        });

        addLog(`Successfully updated ${device.label}`);
      }

      // Stage 3: Complete
      setStage('complete');
      addLog('All devices updated successfully!');
      onComplete(true);
    } catch (err) {
      const errorMessage =
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : JSON.stringify(err) || 'Unknown error occurred';
      setError(errorMessage);
      setShowLogs(true); // Auto-expand logs on error
      addLog(`✗ Error: ${errorMessage}`);
      onComplete(false);
    }
  };

  const getStageIcon = (stageName: string) => {
    switch (stageName) {
      case 'downloading':
        return <Download className="h-4 w-4" />;
      case 'preparing':
        return <Usb className="h-4 w-4" />;
      case 'copying':
        return <Copy className="h-4 w-4" />;
      case 'configuring':
        return <Settings className="h-4 w-4" />;
      case 'complete':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'error':
        return <XCircle className="h-4 w-4" />;
      default:
        return <Loader2 className="h-4 w-4 animate-spin" />;
    }
  };

  const getOverallProgress = () => {
    if (stage === 'validating') {
      return 0; // Validation happens before download
    }

    if (stage === 'downloading') {
      return Math.min(downloadProgress * 0.2, 20); // 20% for download, capped
    }

    if (stage === 'installing') {
      const deviceProgressSum = Array.from(deviceProgress.values()).reduce(
        (sum, p) => sum + Math.min(p.progress, 100), // Cap each device at 100%
        0
      );
      const avgDeviceProgress =
        devices.length > 0 ? deviceProgressSum / devices.length : 0;
      // Overall formula: 20% download + 80% installation
      // Cap the result at 100% to prevent overflow
      return Math.min(20 + avgDeviceProgress * 0.8, 100);
    }

    return 100;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">
          {error && 'Installation Failed'}
          {!error && stage === 'validating' && 'Validating Devices'}
          {!error && stage === 'downloading' && 'Downloading Firmware'}
          {!error && stage === 'installing' && 'Installing Firmware'}
          {!error && stage === 'complete' && 'Installation Complete'}
        </h2>
        <p className="text-muted-foreground">
          {error &&
            'The installation process encountered an error. Please review the details below and try again.'}
          {!error && stage === 'validating' &&
            'Checking device connectivity, permissions, and available space...'}
          {!error && stage === 'downloading' &&
            'Downloading firmware package from GitHub...'}
          {!error && stage === 'installing' &&
            'Installing firmware on selected devices...'}
          {!error && stage === 'complete' && 'All devices have been updated successfully'}
        </p>
      </div>

      {/* Overall Progress */}
      {!error && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overall Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={getOverallProgress()} className="h-2" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {stage === 'validating' && 'Validating devices...'}
                {stage === 'downloading' && 'Downloading...'}
                {stage === 'installing' &&
                  `Updating ${devices.length} device${devices.length !== 1 ? 's' : ''}...`}
                {stage === 'complete' && 'Complete'}
              </span>
              <span className="font-medium">
                {Math.round(getOverallProgress())}%
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State Card with Actions */}
      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-base text-destructive">
                Installation Failed
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{error}</p>

            {error && getErrorGuidance(error) && (
              <div className="space-y-2">
                <p className="font-semibold text-sm">How to fix this:</p>
                <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                  {getErrorGuidance(error)?.resolutionSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-2">
              <Button onClick={handleStartOver}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Start Over
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Download Progress */}
      {stage === 'downloading' && !error && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              <CardTitle className="text-base">Downloading Firmware</CardTitle>
            </div>
            <CardDescription>Version {release.version}</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={downloadProgress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Device Progress */}
      {(stage === 'installing' || stage === 'complete') && !error && (
        <div className="space-y-3">
          {updatedDevices.map((device) => {
            const progress = deviceProgress.get(device.path);
            const isComplete = progress?.stage === 'complete';
            const hasError = progress?.stage === 'error';

            return (
              <Card key={device.path}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CircuitBoard className="h-5 w-5" />
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {device.label}
                          <Badge variant="secondary" className="text-xs">
                            {device.role}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {device.path}
                        </CardDescription>
                      </div>
                    </div>
                    {isComplete && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                    {hasError && (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    {!isComplete && !hasError && (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {progress && (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        {getStageIcon(progress.stage)}
                        <span className="text-muted-foreground">
                          {progress.message}
                        </span>
                      </div>
                      {progress.currentFile && (
                        <p className="text-xs text-muted-foreground">
                          {progress.currentFile}
                        </p>
                      )}
                      <Progress value={progress.progress} className="h-2" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {progress.stage.charAt(0).toUpperCase() +
                            progress.stage.slice(1)}
                        </span>
                        <span>{Math.round(progress.progress)}%</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}


      {/* Logs Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Installation Log</CardTitle>
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
    </div>
  );
}
