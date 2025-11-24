import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { deviceService } from '@/services/DeviceService';
import { Device, DeviceRole } from '@/types';
import { AlertCircle, CheckCircle2, HardDrive, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DeviceSelectionProps {
  selectedDevices: Device[];
  onDevicesChange: (devices: Device[]) => void;
  onRoleChange: (devicePath: string, role: DeviceRole) => void;
}

export function DeviceSelection({
  selectedDevices,
  onDevicesChange,
  onRoleChange,
}: DeviceSelectionProps) {
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    detectDevices();
  }, []);

  const detectDevices = async () => {
    try {
      setLoading(true);
      const devices = await deviceService.detectDevices();
      setAvailableDevices(devices);

      if (devices.length === 0) {
        toast({
          title: 'No Devices Found',
          description:
            'Please connect a BlueBuzzah device and try again.',
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

  const toggleDeviceSelection = (device: Device) => {
    const isSelected = selectedDevices.some((d) => d.path === device.path);

    if (isSelected) {
      // Deselect device
      onDevicesChange(selectedDevices.filter((d) => d.path !== device.path));
    } else {
      // Select device
      const newDevices = [...selectedDevices, device];

      // Auto-assign roles if we have 2 devices
      if (newDevices.length === 2) {
        const updatedDevices = newDevices.map((d, index) => ({
          ...d,
          role: (index === 0 ? 'PRIMARY' : 'SECONDARY') as DeviceRole,
        }));
        onDevicesChange(updatedDevices);
      } else {
        onDevicesChange(newDevices);
      }
    }
  };

  const isDeviceSelected = (devicePath: string) => {
    return selectedDevices.some((d) => d.path === devicePath);
  };

  const getDeviceRole = (devicePath: string): DeviceRole | undefined => {
    return selectedDevices.find((d) => d.path === devicePath)?.role;
  };

  const canProceed = () => {
    if (selectedDevices.length === 0) return false;
    return selectedDevices.every((d) => d.role !== undefined);
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
          Choose the devices to update and assign roles
        </p>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {availableDevices.length} device{availableDevices.length !== 1 ? 's' : ''} found
          </Badge>
          {selectedDevices.length > 0 && (
            <Badge variant="default">
              {selectedDevices.length} selected
            </Badge>
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
              Make sure your BlueBuzzah device is connected via USB and mounted
              as BLUEBUZZAH or CIRCUITPY
            </p>
            <div className="text-sm text-left bg-muted p-4 rounded-md space-y-2">
              <p className="font-semibold">Troubleshooting:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Check USB cable connection</li>
                <li>Ensure device is in CircuitPython mode</li>
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
            const role = getDeviceRole(device.path);

            return (
              <Card
                key={device.path}
                className={`transition-all cursor-pointer hover:shadow-lg ${
                  selected ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => toggleDeviceSelection(device)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <HardDrive className="h-5 w-5" />
                      <div>
                        <CardTitle className="text-base">
                          {device.label}
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                          {device.path}
                        </CardDescription>
                      </div>
                    </div>
                    {selected && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </CardHeader>

                {selected && (
                  <CardContent onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Device Role
                      </label>
                      <Select
                        value={role}
                        onValueChange={(value) =>
                          onRoleChange(device.path, value as DeviceRole)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PRIMARY">
                            PRIMARY
                            <span className="text-xs text-muted-foreground ml-2">
                              (Coordinator)
                            </span>
                          </SelectItem>
                          <SelectItem value="SECONDARY">
                            SECONDARY
                            <span className="text-xs text-muted-foreground ml-2">
                              (Listener)
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {role === 'PRIMARY' &&
                          'Primary device coordinates communication'}
                        {role === 'SECONDARY' &&
                          'Secondary device listens for commands'}
                      </p>
                    </div>
                  </CardContent>
                )}
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
                <p className="text-sm font-medium">Device Roles</p>
                <p className="text-sm text-muted-foreground">
                  {selectedDevices.length === 1
                    ? 'Please select a role for your device.'
                    : selectedDevices.length === 2
                    ? 'Roles have been auto-assigned. You can change them if needed.'
                    : 'You can update up to 2 devices at once.'}
                </p>
                {!canProceed() && (
                  <p className="text-sm text-destructive">
                    All selected devices must have a role assigned.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
