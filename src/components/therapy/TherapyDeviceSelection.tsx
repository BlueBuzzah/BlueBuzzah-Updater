import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { deviceService } from '@/services/DeviceService';
import { getProfileInfo } from '@/lib/therapy-profiles';
import type { Device, TherapyProfile } from '@/types';
import {
  AlertCircle,
  CheckCircle2,
  CircuitBoard,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface TherapyDeviceSelectionProps {
  selectedProfile: TherapyProfile;
  selectedDevices: Device[];
  onToggleDevice: (device: Device) => void;
}

export function TherapyDeviceSelection({
  selectedProfile,
  selectedDevices,
  onToggleDevice,
}: TherapyDeviceSelectionProps) {
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const profileInfo = getProfileInfo(selectedProfile);

  useEffect(() => {
    detectDevices();
  }, []);

  const detectDevices = async () => {
    try {
      setLoading(true);
      const devices = await deviceService.detectDevices();
      // Filter out devices in bootloader mode - profile config only works in app mode
      const appModeDevices = devices.filter((d) => !d.inBootloader);
      setAvailableDevices(appModeDevices);

      if (appModeDevices.length === 0) {
        toast({
          title: 'No Devices Found',
          description:
            'Please connect a BlueBuzzah device and ensure it has booted completely.',
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to detect devices',
      });
    } finally {
      setLoading(false);
    }
  };

  const isDeviceSelected = (devicePath: string) => {
    return selectedDevices.some((d) => d.path === devicePath);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Detecting devices...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Select Devices</h2>
        <p className="text-muted-foreground">
          Choose devices to configure with the{' '}
          <span className="font-medium text-primary">{profileInfo?.name}</span>{' '}
          profile
        </p>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {availableDevices.length} device
            {availableDevices.length !== 1 ? 's' : ''} found
          </Badge>
          {selectedDevices.length > 0 && (
            <Badge variant="default">{selectedDevices.length} selected</Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={detectDevices}
          disabled={loading}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {availableDevices.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="pt-6 pb-6 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              No BlueBuzzah Devices Found
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Make sure your BlueBuzzah device is connected and has fully
              booted.
            </p>
            <div className="text-sm text-left bg-muted p-4 rounded-md space-y-2">
              <p className="font-semibold">Troubleshooting:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>
                  Check USB cable connection (use a data cable, not charge-only)
                </li>
                <li>Wait for device to fully boot (LED indicators)</li>
                <li>Try a different USB port</li>
                <li>Restart your device</li>
              </ul>
            </div>
            <Button onClick={detectDevices} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {availableDevices.map((device) => {
            const selected = isDeviceSelected(device.path);

            return (
              <Card
                key={device.path}
                className={`transition-all cursor-pointer hover:shadow-lg ${
                  selected ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => onToggleDevice(device)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <CircuitBoard className="h-[1.875rem] w-[1.875rem]" />
                      <div>
                        <CardTitle className="text-base">
                          {device.label}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {device.path}
                        </CardDescription>
                        {device.serialNumber && (
                          <p className="text-xs text-muted-foreground mt-1">
                            S/N: {device.serialNumber}
                          </p>
                        )}
                      </div>
                    </div>
                    {selected && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}

      {selectedDevices.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Ready to Configure</p>
                <p className="text-sm text-muted-foreground">
                  {selectedDevices.length === 1
                    ? `1 device will be configured with the ${profileInfo?.name} profile.`
                    : `${selectedDevices.length} devices will be configured with the ${profileInfo?.name} profile.`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedDevices.length === 0 && availableDevices.length > 0 && (
        <p className="text-sm text-muted-foreground text-center">
          Click on a device to select it for configuration.
        </p>
      )}
    </div>
  );
}
