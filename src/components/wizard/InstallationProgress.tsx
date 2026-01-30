import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { formatValidationErrors, getErrorGuidance } from '@/lib/error-messages';
import { deviceService } from '@/services/DeviceService';
import { firmwareService } from '@/services/FirmwareService';
import { useWizardStore } from '@/stores/wizardStore';
import { Device, DeviceUpdateResult, FirmwareRelease, UpdateProgress, UpdateResult } from '@/types';
import {
	AlertTriangle,
	Ban,
	CheckCircle2,
	CircuitBoard,
	ClipboardCopy,
	Copy,
	Download,
	Loader2,
	RotateCcw,
	Settings,
	Usb,
	XCircle
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface InstallationProgressProps {
  release: FirmwareRelease;
  devices: Device[];
  onComplete: (result: UpdateResult) => void;
  onProgressUpdate: (devicePath: string, progress: UpdateProgress) => void;
}

export function InstallationProgress({
  release,
  devices,
  onComplete,
  onProgressUpdate,
}: InstallationProgressProps) {
  const { updateDeviceInfo, addLog: storeAddLog, logs } = useWizardStore();
  const { toast } = useToast();
  const [stage, setStage] = useState<'validating' | 'downloading' | 'installing' | 'complete'>(
    'validating'
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deviceProgress, setDeviceProgress] = useState<
    Map<string, UpdateProgress>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [updatedDevices, setUpdatedDevices] = useState<Device[]>(devices);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const hasStartedRef = useRef(false);
  const cancelledRef = useRef(false);
  const completedDevices = useRef<Set<string>>(new Set());
  const devicePathMap = useRef<Map<string, { path: string; label: string }>>(new Map());
  const deviceResults = useRef<DeviceUpdateResult[]>([]);

  // Track retry attempts for auto-expanding logs
  const [retryCount, setRetryCount] = useState(0);
  const RETRY_THRESHOLD = 2; // Auto-expand after this many retries

  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startInstallation();

    return () => {
      cancelledRef.current = true;
      deviceService.cancelFlash().catch(() => {});
    };
  }, []);

  const addLog = (message: string) => {
    storeAddLog(`[${new Date().toLocaleTimeString()}] ${message}`);

    // Detect retry messages and track count
    const lowerMessage = message.toLowerCase();
    const isRetryMessage =
      (lowerMessage.includes('retry') && (lowerMessage.includes('/3') || lowerMessage.includes('attempt'))) ||
      lowerMessage.includes('retrying') ||
      lowerMessage.includes('recovered after');

    if (isRetryMessage) {
      setRetryCount((prev) => {
        const newCount = prev + 1;
        // Auto-expand logs if threshold exceeded and not already showing
        if (newCount >= RETRY_THRESHOLD && !showLogs) {
          setShowLogs(true);
        }
        return newCount;
      });
    }
  };

  const exportLogs = () => {
    const logsText = logs.join('\n');
    navigator.clipboard.writeText(logsText);
    toast({
      title: 'Logs copied',
      description: 'Installation logs have been copied to clipboard',
    });
  };

  const handleRetry = () => {
    const retryDevices = updatedDevices.filter(
      (d) => !completedDevices.current.has(d.path)
    );
    setError(null);
    setStage('validating');
    setDownloadProgress(0);
    setDeviceProgress((prev) => {
      const next = new Map(prev);
      for (const d of retryDevices) {
        next.delete(d.path);
      }
      return next;
    });
    setRetryCount(0);
    setIsCancelling(false);
    cancelledRef.current = false;
    deviceResults.current = deviceResults.current.filter(
      (r) => completedDevices.current.has(r.device.path)
    );
    addLog('--- Retrying failed devices ---');
    startInstallation(retryDevices);
  };

  const handleStopClick = () => {
    setShowStopConfirm(true);
  };

  const confirmStop = async () => {
    setShowStopConfirm(false);
    setIsCancelling(true);
    cancelledRef.current = true;
    addLog('Cancellation requested - stopping installation...');
    try {
      await deviceService.cancelFlash();
    } catch (err) {
      console.error('Failed to cancel:', err);
    }
  };

  const startInstallation = async (devicesToFlash?: Device[]) => {
    const targetDevices = devicesToFlash ?? updatedDevices;

    try {
      // Stage 0: Validate devices
      addLog('Validating devices before installation...');
      setStage('validating');

      const validationResults = await deviceService.validateDevices(targetDevices);
      let hasValidationErrors = false;
      const validationErrors: string[] = [];

      validationResults.forEach((result, devicePath) => {
        const device = targetDevices.find((d) => d.path === devicePath);
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
      addLog(`Installing firmware on ${targetDevices.length} device(s)...`);

      for (const device of targetDevices) {
        // Check cancellation before starting next device (H8 fix)
        if (cancelledRef.current) {
          addLog(`Skipping ${device.label} — installation cancelled`);
          break;
        }

        // Track current path/label locally to avoid mutating the original device object (C8 fix)
        let currentPath = device.path;
        let currentLabel = device.label;

        addLog(`Starting update for ${currentLabel} (${device.role})...`);

        try {
          await deviceService.deployFirmware(
            device,
            firmware,
            // Progress callback - updates UI state
            (progress) => {
              // Check if device info was updated (volume renamed)
              if (progress.newDeviceLabel && progress.newDevicePath) {
                const originalPath = device.path;

                // Track rename in map (instead of mutating device object)
                devicePathMap.current.set(originalPath, {
                  path: progress.newDevicePath!,
                  label: progress.newDeviceLabel!,
                });

                // Update local tracking variables
                currentPath = progress.newDevicePath!;
                currentLabel = progress.newDeviceLabel!;

                // Update wizard store with new device info
                updateDeviceInfo(originalPath, progress.newDeviceLabel, progress.newDevicePath);

                // Update local device references
                setUpdatedDevices((prev) =>
                  prev.map((d) =>
                    d.path === originalPath
                      ? { ...d, label: progress.newDeviceLabel!, path: progress.newDevicePath! }
                      : d
                  )
                );

                // Update deviceProgress map with new path as key
                setDeviceProgress((prev) => {
                  const next = new Map(prev);
                  const oldProgress = next.get(originalPath);
                  if (oldProgress) {
                    next.delete(originalPath);
                    next.set(progress.newDevicePath!, progress);
                  } else {
                    next.set(progress.newDevicePath!, progress);
                  }
                  return next;
                });

                addLog(`✓ Volume renamed to ${progress.newDeviceLabel}`);
              } else {
                setDeviceProgress((prev) => {
                  const next = new Map(prev);
                  next.set(currentPath, progress);
                  return next;
                });
              }

              onProgressUpdate(currentPath, progress);
            },
            // Log callback - goes directly to log panel
            (logMessage) => {
              addLog(`${currentLabel}: ${logMessage}`);
            }
          );

          // Track both original and renamed paths as completed
          completedDevices.current.add(device.path);
          if (currentPath !== device.path) {
            completedDevices.current.add(currentPath);
          }
          addLog(`✓ Successfully updated ${currentLabel}`);
          deviceResults.current.push({ device, success: true });
        } catch (deviceErr) {
          const deviceErrorMessage =
            typeof deviceErr === 'string'
              ? deviceErr
              : deviceErr instanceof Error
                ? deviceErr.message
                : JSON.stringify(deviceErr) || 'Unknown error occurred';
          addLog(`✗ Error updating ${currentLabel}: ${deviceErrorMessage}`);
          setShowLogs(true);
          deviceResults.current.push({ device, success: false, error: deviceErrorMessage });
          // Continue to next device instead of aborting
        }
      }

      // Stage 3: Complete (only if not cancelled)
      if (!cancelledRef.current) {
        const overallSuccess = deviceResults.current.every((r) => r.success);
        setStage('complete');

        if (overallSuccess) {
          addLog('All devices updated successfully!');
        } else {
          const successCount = deviceResults.current.filter((r) => r.success).length;
          const failCount = deviceResults.current.filter((r) => !r.success).length;
          addLog(`Installation completed: ${successCount} succeeded, ${failCount} failed`);
          setError(`${failCount} device(s) failed to update`);
          setShowLogs(true);
        }

        onComplete({
          success: overallSuccess,
          message: overallSuccess
            ? 'All devices updated successfully'
            : 'Some devices failed to update',
          deviceUpdates: deviceResults.current,
        });
      }
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
      onComplete({
        success: false,
        message: errorMessage,
        deviceUpdates: targetDevices.map((d) => ({
          device: d,
          success: false,
          error: errorMessage,
        })),
      });
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
      case 'cancelled':
        return <AlertTriangle className="h-4 w-4" />;
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Overall Progress</CardTitle>
                {retryCount > 0 && !error && (
                  <Badge variant="outline" className="text-amber-500 border-amber-500">
                    {retryCount} auto-{retryCount === 1 ? 'retry' : 'retries'}
                  </Badge>
                )}
              </div>
              {stage !== 'complete' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStopClick}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Stopping...
                    </>
                  ) : (
                    <>
                      <Ban className="h-4 w-4 mr-2" />
                      Stop
                    </>
                  )}
                </Button>
              )}
            </div>
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
              <Button onClick={handleRetry}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Retry
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
            const isCancelled = progress?.stage === 'cancelled';

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
                    {isCancelled && (
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                    )}
                    {!isComplete && !hasError && !isCancelled && (
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

      {/* Stop Confirmation Dialog */}
      <AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Installation?</AlertDialogTitle>
            <AlertDialogDescription>
              Stopping the installation may leave your device in bootloader mode.
              You can recover by pressing the reset button twice quickly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
