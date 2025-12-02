import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { useWizardStore } from '@/stores/wizardStore';
import { Device, FirmwareRelease } from '@/types';
import {
	AlertCircle,
	CheckCircle2,
	ClipboardCopy,
	HardDrive,
	RotateCcw,
	X,
} from 'lucide-react';
import React from 'react';

interface SuccessScreenProps {
  release: FirmwareRelease;
  devices: Device[];
  onReset: () => void;
  onClose: () => void;
}

export function SuccessScreen({
  release,
  devices,
  onReset,
  onClose,
}: SuccessScreenProps) {
  const { toast } = useToast();
  const { logs } = useWizardStore();
  const [showLogs, setShowLogs] = useState(false);

  const exportLogs = () => {
    const logsText = logs.join('\n');
    navigator.clipboard.writeText(logsText);
    toast({
      title: 'Logs copied',
      description: 'Installation logs have been copied to clipboard',
    });
  };

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="relative">
            <CheckCircle2 className="h-20 w-20 text-primary animate-in zoom-in-50 duration-300" />
            <div className="absolute inset-0 bg-primary rounded-full blur-xl opacity-20 animate-pulse" />
          </div>
        </div>

        <div>
          <h2 className="text-3xl font-bold mb-2">Installation Complete!</h2>
          <p className="text-muted-foreground">
            Your devices have been successfully updated
          </p>
        </div>
      </div>

      {/* Firmware Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Installed Firmware</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{release.version}</p>
              <p className="text-sm text-muted-foreground">
                Published on{' '}
                {new Date(release.publishedAt).toLocaleDateString()}
              </p>
            </div>
            <Badge variant="secondary">Latest</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Updated Devices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Updated Devices</CardTitle>
          <CardDescription>
            {devices.length} device{devices.length !== 1 ? 's' : ''} updated
            successfully
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.map((device, index) => (
            <React.Fragment key={device.path}>
              {index > 0 && <Separator />}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <HardDrive className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{device.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {device.path}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={device.role === 'PRIMARY' ? 'default' : 'secondary'}
                >
                  {device.role}
                </Badge>
              </div>
            </React.Fragment>
          ))}
        </CardContent>
      </Card>

      {/* Post-Installation Instructions */}
      <Card className="border-primary/50 bg-primary/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Next Steps</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                1
              </span>
              <div>
                <p className="font-medium">Safely Eject Drives</p>
                <p className="text-muted-foreground">
                  Unmount all BLUEBUZZAH drives before disconnecting
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                2
              </span>
              <div>
                <p className="font-medium">Power On PRIMARY First</p>
                <p className="text-muted-foreground">
                  Start the PRIMARY device to initialize coordination
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                3
              </span>
              <div>
                <p className="font-medium">Power On SECONDARY Within 15s</p>
                <p className="text-muted-foreground">
                  Start the SECONDARY device within 15 seconds for pairing
                </p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>

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

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <Button variant="outline" onClick={onReset}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Update Another Device
        </Button>
        <Button onClick={onClose}>
          <X className="h-4 w-4 mr-2" />
          Close
        </Button>
      </div>
    </div>
  );
}
