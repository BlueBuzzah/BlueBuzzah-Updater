import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { getProfileInfo } from '@/lib/therapy-profiles';
import { useTherapyStore } from '@/stores/therapyStore';
import type { Device, TherapyProfile, TherapyConfigResult } from '@/types';
import {
  CheckCircle2,
  CircuitBoard,
  ClipboardCopy,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';

interface TherapySuccessProps {
  profile: TherapyProfile;
  devices: Device[];
  result: TherapyConfigResult;
  onReset: () => void;
  onClose: () => void;
}

export function TherapySuccess({
  profile,
  devices,
  result,
  onReset,
  onClose,
}: TherapySuccessProps) {
  const { toast } = useToast();
  const { logs } = useTherapyStore();
  const [showLogs, setShowLogs] = useState(false);

  const profileInfo = getProfileInfo(profile);
  const successCount = result.deviceConfigs.filter((c) => c.success).length;
  const failCount = result.deviceConfigs.filter((c) => !c.success).length;

  const exportLogs = () => {
    const logsText = logs.join('\n');
    navigator.clipboard.writeText(logsText);
    toast({
      title: 'Logs copied',
      description: 'Configuration logs have been copied to clipboard',
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        {result.success ? (
          <>
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Configuration Complete</h2>
            <p className="text-muted-foreground">
              {successCount === 1
                ? 'Your device has been configured successfully.'
                : `All ${successCount} devices have been configured successfully.`}
            </p>
          </>
        ) : (
          <>
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <XCircle className="h-10 w-10 text-destructive" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Configuration Issues</h2>
            <p className="text-muted-foreground">
              {failCount === devices.length
                ? 'All devices failed to configure.'
                : `${failCount} of ${devices.length} device${failCount !== 1 ? 's' : ''} failed to configure.`}
            </p>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Applied</CardTitle>
          <CardDescription>
            {profileInfo?.name} - {profileInfo?.description}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured Devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.deviceConfigs.map((config) => (
            <div
              key={config.device.path}
              className={`flex items-center justify-between p-3 rounded-lg ${
                config.success ? 'bg-muted/50' : 'bg-destructive/10'
              }`}
            >
              <div className="flex items-center gap-3">
                <CircuitBoard className="h-5 w-5" />
                <div>
                  <p className="font-medium">{config.device.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {config.device.path}
                  </p>
                </div>
              </div>
              {config.success ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-destructive">
                    {config.error || 'Failed'}
                  </span>
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {result.success && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="space-y-2">
              <p className="text-sm font-medium">Next Steps:</p>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Your device{successCount > 1 ? 's are' : ' is'} ready to use</li>
                <li>
                  The {profileInfo?.name} profile is now active
                </li>
                <li>You can safely disconnect your device{successCount > 1 ? 's' : ''}</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      )}

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

      <div className="flex gap-4 justify-center">
        <Button variant="outline" onClick={onReset}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Configure More Devices
        </Button>
        <Button onClick={onClose}>
          <X className="h-4 w-4 mr-2" />
          Close
        </Button>
      </div>
    </div>
  );
}
