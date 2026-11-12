import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceCard } from '@/components/ui/device-card';
import { StatusBadge } from '@/components/ui/status-badge';
import { getErrorGuidance } from '@/lib/error-messages';
import type { Device, DeviceRole, DeviceUpdateResult } from '@/types';
import { BOARD_NAME } from './DeviceSelection';

const ROLE_WORD: Record<DeviceRole, string> = { PRIMARY: 'Primary', SECONDARY: 'Secondary' };

interface FlashOutcomeProps {
  version: string;
  devices: Device[];
  results: DeviceUpdateResult[];
  /** The error that stopped the run, if any */
  error?: string | null;
  /** Copied by "Copy Details" */
  logText: string;
}

/** updater.md step 4 (Verify): one Banner for the outcome, then each device with a word for its state. */
export function FlashOutcome({ version, devices, results, error, logText }: FlashOutcomeProps) {
  const failed = results.filter((r) => !r.success);
  const succeeded = results.length - failed.length;
  const tone = failed.length === 0 && !error ? 'success' : succeeded > 0 ? 'warning' : 'danger';
  const detail = error ?? failed[0]?.error ?? '';
  const guidance = detail ? getErrorGuidance(detail) : null;
  // Devices that updated but reported a problem afterwards (boot faults, role not set).
  const warned = results.filter((r) => r.success && (r.warnings?.length ?? 0) > 0);
  const warningLines = warned.flatMap((r) =>
    (r.warnings ?? []).map((warning) => `${r.device.role ? ROLE_WORD[r.device.role] : 'Device'} (${r.device.path}): ${warning}`)
  );
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
      Copy Details
    </Button>
  );
  const both = devices.length > 1;
  const warnedRole = warned[0]?.device.role;
  const warnedWho =
    warned.length > 1 ? 'Both devices' : warnedRole ? `The ${ROLE_WORD[warnedRole].toLowerCase()} device` : 'Your device';

  return (
    <div className="grid gap-6">
      <div ref={titleRef} tabIndex={-1}>
        {tone === 'success' ? (
          <Banner
            tone={warned.length > 0 ? 'warning' : 'success'}
            announce
            title={
              <>
                Firmware <code className="code">{version}</code> is on {both ? 'both devices' : 'your device'}
              </>
            }
          >
            {warned.length > 0
              ? `${warnedWho} ${warned.length > 1 ? 'need' : 'needs'} attention. Check the details below.`
              : both
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
              <ol className="list-decimal pl-6">
                {guidance.resolutionSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </Banner>
        )}
      </div>
      {((tone !== 'success' && detail) || warningLines.length > 0) && (
        <div className="grid gap-2">
          <p className="label">Details</p>
          {tone !== 'success' && detail && (
            <p className="code-s whitespace-pre-wrap rounded-md bg-surface-sunken p-4">{detail}</p>
          )}
          {warningLines.length > 0 && (
            <ul className="code-s grid gap-2 whitespace-pre-wrap rounded-md bg-surface-sunken p-4">
              {warningLines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="body-s" aria-live="polite">{copied}</p>
      <ul className="grid gap-6 sm:grid-cols-2">
        {devices.map((device) => {
          const result = results.find((r) => r.device.path === device.path);
          const state = !result?.success
            ? ({ tone: 'danger', word: 'Failed' } as const)
            : (result.warnings?.length ?? 0) > 0
              ? ({ tone: 'warning', word: 'Warning' } as const)
              : ({ tone: 'success', word: 'Done' } as const);
          return (
            <li key={device.path}>
              <DeviceCard
                name={BOARD_NAME[device.board]}
                role={device.role}
                port={device.path}
                status={<StatusBadge tone={state.tone}>{state.word}</StatusBadge>}
                statusLabel={state.word}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
