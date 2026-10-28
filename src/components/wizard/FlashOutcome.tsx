import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceCard } from '@/components/ui/device-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { getErrorGuidance } from '@/lib/error-messages';
import type { Device, DeviceUpdateResult } from '@/types';
import { BOARD_NAME } from './DeviceSelection';

interface FlashOutcomeProps {
  version: string;
  devices: Device[];
  results: DeviceUpdateResult[];
  /** The error that stopped the run, if any */
  error?: string | null;
  /** Copied by "Copy details" */
  logText: string;
  actions?: ReactNode;
}

/** updater.md step 4 (Verify): one Banner for the outcome, then each device with a word for its state. */
export function FlashOutcome({ version, devices, results, error, logText, actions }: FlashOutcomeProps) {
  const failed = results.filter((r) => !r.success);
  const succeeded = results.length - failed.length;
  const tone = failed.length === 0 && !error ? 'success' : succeeded > 0 ? 'warning' : 'danger';
  const detail = error ?? failed[0]?.error ?? '';
  const guidance = detail ? getErrorGuidance(detail) : null;
  const titleRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => titleRef.current?.focus(), []);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(logText);
      setCopied('Details copied.');
    } catch {
      setCopied("Couldn't copy the details.");
    }
  };
  const copyAction = (
    <Button variant="secondary" icon={Copy} onClick={copyDetails}>
      Copy details
    </Button>
  );
  const both = devices.length > 1;

  return (
    <div className="grid gap-6">
      <div ref={titleRef} tabIndex={-1}>
        {tone === 'success' ? (
          <Banner
            tone="success"
            announce
            title={
              <>
                Firmware <code className="code">{version}</code> is on {both ? 'both devices' : 'your device'}
              </>
            }
          >
            {both
              ? 'You can unplug both devices. Turn them on and they find each other on their own.'
              : "You can unplug the device. It's ready to use."}
          </Banner>
        ) : (
          <Banner
            tone={tone}
            announce
            title={
              tone === 'warning'
                ? `${failed.length} of ${results.length} devices didn't update`
                : (guidance?.title ?? "The flash didn't finish")
            }
            action={copyAction}
          >
            {guidance && <p>{guidance.description}</p>}
            {guidance && (
              <ol className="mt-2 list-decimal pl-6">
                {guidance.resolutionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </Banner>
        )}
      </div>
      {tone !== 'success' && detail && (
        <div className="grid gap-2">
          <p className="label">Details</p>
          <p className="code-s whitespace-pre-wrap rounded-md bg-surface-sunken p-4">{detail}</p>
        </div>
      )}
      <p className="body-s" aria-live="polite">{copied}</p>
      <ul className="grid gap-6 sm:grid-cols-2">
        {devices.map((device) => {
          const ok = results.find((r) => r.device.path === device.path)?.success;
          const word = ok ? 'Done' : 'Failed';
          return (
            <li key={device.path}>
              <DeviceCard
                name={BOARD_NAME[device.board]}
                role={device.role}
                port={device.path}
                status={<StatusBadge tone={ok ? 'success' : 'danger'}>{word}</StatusBadge>}
                statusLabel={word}
              />
            </li>
          );
        })}
      </ul>
      {actions && <div className="flex flex-wrap gap-target-gap">{actions}</div>}
    </div>
  );
}
