import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceCard } from '@/components/ui/device-card';
import { LogPane } from '@/components/ui/log-pane';
import { StatusBadge, type Tone } from '@/components/ui/status-badge';
import { BOARD_NAME } from '@/components/wizard/DeviceSelection';
import { getErrorGuidance } from '@/lib/error-messages';
import { getProfileInfo } from '@/lib/therapy-profiles';
import { useTherapyStore } from '@/stores/therapyStore';
import type { Device, DeviceConfigResult, TherapyConfigResult, TherapyProfile } from '@/types';

interface TherapySuccessProps {
  profile: TherapyProfile;
  devices: Device[];
  result: TherapyConfigResult;
  onReset: () => void;
  onClose: () => void;
}

function deviceWord(c?: DeviceConfigResult): { tone: Tone; word: string } {
  if (!c || !c.success) return { tone: 'danger', word: 'Failed' };
  if (c.outcome?.status === 'partial') return { tone: 'warning', word: 'Partly done' };
  return { tone: 'success', word: 'Done' };
}

/** The finished setup: one Banner that says what really happened, then each device. */
export function TherapySuccess({ profile, devices, result, onReset, onClose }: TherapySuccessProps) {
  const { logs } = useTherapyStore();
  const [copied, setCopied] = useState('');
  const bannerRef = useRef<HTMLDivElement>(null);
  const name = getProfileInfo(profile)?.name ?? profile;
  const configs = result.deviceConfigs;
  const failed = configs.filter((c) => !c.success);
  const partial = configs.some((c) => c.outcome?.status === 'partial');
  // Only a Secondary answered: the profile may have changed, but custom values never reached a Primary.
  const noPrimary = configs.length > 0 && configs.every((c) => c.outcome?.status === 'success_secondary');
  const guidance = failed[0]?.error ? getErrorGuidance(failed[0].error) : null;
  const both = devices.length > 1;

  useEffect(() => bannerRef.current?.focus(), []);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied('Details copied.');
    } catch {
      setCopied("Couldn't copy the details.");
    }
  };

  const banner = (() => {
    if (failed.length > 0) {
      return (
        <Banner
          tone="danger"
          announce
          title={`Setup didn't finish on ${failed.length} of ${configs.length} ${configs.length === 1 ? 'device' : 'devices'}`}
          action={
            <Button variant="secondary" icon={Copy} onClick={copyDetails}>
              Copy details
            </Button>
          }
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
      );
    }
    if (partial) {
      return (
        <Banner tone="warning" announce title="The pattern changed, but your custom settings may not have saved">
          Select Apply to devices to try again.
        </Banner>
      );
    }
    if (noPrimary) {
      return (
        <Banner tone="warning" announce title="Custom settings weren't applied">
          No device answered as the Primary device. Plug in your Primary device, then select Apply to devices again.
        </Banner>
      );
    }
    return (
      <Banner tone="success" announce title={`${name} is set on ${both ? 'both devices' : 'your device'}`}>
        You can unplug the devices. They&apos;re ready to use.
      </Banner>
    );
  })();

  return (
    <div className="grid max-w-content gap-10">
      <div ref={bannerRef} tabIndex={-1}>
        {banner}
      </div>
      <p className="body-s" aria-live="polite">{copied}</p>
      <ul className="grid gap-6 sm:grid-cols-2">
        {devices.map((device) => {
          const config = configs.find((c) => c.device.path === device.path);
          const state = deviceWord(config);
          return (
            <li key={device.path} className="grid content-start gap-2">
              <DeviceCard
                name={BOARD_NAME[device.board]}
                port={device.path}
                status={<StatusBadge tone={state.tone}>{state.word}</StatusBadge>}
                statusLabel={state.word}
              />
              {config?.error && <p className="code-s text-ink-muted">{config.error}</p>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-target-gap">
        <Button variant="secondary" onClick={onReset}>
          Set up another device
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
      <LogPane lines={logs} fileName="bluebuzzah-updater-setup-log.txt" />
    </div>
  );
}
