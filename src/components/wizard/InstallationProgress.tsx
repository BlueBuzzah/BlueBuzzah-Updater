import { useEffect, useState } from 'react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  Download,
  Trash2,
  Copy,
  Settings,
} from 'lucide-react';
import { Device, FirmwareRelease, UpdateProgress } from '@/types';
import { firmwareService } from '@/services/FirmwareService';
import { deviceService } from '@/services/DeviceService';
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
  const [stage, setStage] = useState<'downloading' | 'installing' | 'complete'>(
    'downloading'
  );
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [deviceProgress, setDeviceProgress] = useState<
    Map<string, UpdateProgress>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    startInstallation();
  }, []);

  const addLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const startInstallation = async () => {
    try {
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

      for (const device of devices) {
        addLog(`Starting update for ${device.label} (${device.role})...`);

        await deviceService.deployFirmware(device, firmware, (progress) => {
          setDeviceProgress((prev) => {
            const next = new Map(prev);
            next.set(device.path, progress);
            return next;
          });
          onProgressUpdate(device.path, progress);

          // Add stage-specific logs
          if (progress.stage === 'wiping') {
            addLog(`Wiping ${device.label}...`);
          } else if (progress.stage === 'copying') {
            if (progress.currentFile) {
              addLog(`Copying ${progress.currentFile} to ${device.label}...`);
            }
          } else if (progress.stage === 'configuring') {
            addLog(`Writing ${device.role} configuration to ${device.label}...`);
          } else if (progress.stage === 'complete') {
            addLog(`✓ ${device.label} update complete`);
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
        err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      addLog(`✗ Error: ${errorMessage}`);
      onComplete(false);
    }
  };

  const getStageIcon = (stageName: string) => {
    switch (stageName) {
      case 'downloading':
        return <Download className="h-4 w-4" />;
      case 'wiping':
        return <Trash2 className="h-4 w-4" />;
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
    if (stage === 'downloading') {
      return downloadProgress * 0.2; // 20% for download
    }

    if (stage === 'installing') {
      const deviceProgressSum = Array.from(deviceProgress.values()).reduce(
        (sum, p) => sum + p.progress,
        0
      );
      const avgDeviceProgress =
        devices.length > 0 ? deviceProgressSum / devices.length : 0;
      return 20 + avgDeviceProgress * 0.8; // 80% for installation
    }

    return 100;
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">
          {stage === 'downloading' && 'Downloading Firmware'}
          {stage === 'installing' && 'Installing Firmware'}
          {stage === 'complete' && 'Installation Complete'}
        </h2>
        <p className="text-muted-foreground">
          {stage === 'downloading' &&
            'Downloading firmware package from GitHub...'}
          {stage === 'installing' &&
            'Installing firmware on selected devices...'}
          {stage === 'complete' && 'All devices have been updated successfully'}
        </p>
      </div>

      {/* Overall Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={getOverallProgress()} className="h-2" />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
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

      {/* Download Progress */}
      {stage === 'downloading' && (
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
      {(stage === 'installing' || stage === 'complete') && (
        <div className="space-y-3">
          {devices.map((device) => {
            const progress = deviceProgress.get(device.path);
            const isComplete = progress?.stage === 'complete';
            const hasError = progress?.stage === 'error';

            return (
              <Card key={device.path}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <HardDrive className="h-5 w-5" />
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

      {/* Error Display */}
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
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Logs Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Installation Log</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
            >
              {showLogs ? 'Hide' : 'Show'} Logs
            </Button>
          </div>
        </CardHeader>
        {showLogs && (
          <CardContent>
            <div className="bg-muted rounded-md p-4 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
              {logs.map((log, index) => (
                <div key={index} className="text-muted-foreground">
                  {log}
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
