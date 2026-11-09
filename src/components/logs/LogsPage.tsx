import { useEffect, useRef } from 'react';
import { ActionBar } from '@/components/shell/ActionBar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LogPane } from '@/components/ui/log-pane';
import { StatusBadge } from '@/components/ui/status-badge';
import { BOARD_NAME, DeviceSelection } from '@/components/wizard/DeviceSelection';
import { cn } from '@/lib/utils';
import { deviceService } from '@/services/DeviceService';
import { monitorService } from '@/services/MonitorService';
import { useLogsStore } from '@/stores/logsStore';
import type { Device, MonitorEvent, MonitorPane } from '@/types';

const NOTE = {
  unplugged: 'Plug the device back in, then select Reconnect.',
  looking: 'Looking for the device…',
  notFound: "Device not found. Check it's plugged in and turned on, then try again.",
};
const MARKER = { disconnected: '--- Disconnected ---', reconnected: '--- Reconnected ---' };

const logFileName = (pane: MonitorPane) =>
  `bluebuzzah-${pane.device.board === 'nrf52' ? 'v2' : 'v3'}-${pane.port.split(/[\\/]/).pop()}-log.txt`;

/** Logs section: read-only serial output from 1 or 2 devices (Workspace issue #38). */
export function LogsPage() {
  const { viewing, selectedDevices, panes, setDevices, setFollow } = useLogsStore();
  // Bumped on every start and stop, so a late event from an earlier run is ignored.
  const run = useRef(0);
  const reconnecting = useRef(new Set<string>());

  /** Routes one monitor's events to its pane while that monitor is still current. */
  const handler = (r: number, key: string, port: string, onFirst?: () => void) => (event: MonitorEvent) => {
    const s = useLogsStore.getState();
    if (r !== run.current || !s.viewing || s.panes[key]?.port !== port) return;
    onFirst?.();
    if (event.event === 'lines') {
      s.append(key, event.data.lines);
    } else {
      s.appendMarker(key, MARKER.disconnected);
      s.setStatus(key, 'disconnected');
      s.setNote(key, NOTE.unplugged);
    }
  };

  const start = async () => {
    const r = ++run.current;
    const s = useLogsStore.getState();
    s.startViewing();
    const fresh = useLogsStore.getState().panes;
    await Promise.all(
      Object.entries(fresh).map(([key, pane]) =>
        monitorService.start(pane.port, handler(r, key, pane.port)).catch(() => {
          if (r !== run.current) return;
          s.setStatus(key, 'disconnected');
          s.setNote(key, NOTE.unplugged);
        })
      )
    );
  };

  const stop = async () => {
    const ports = Object.values(useLogsStore.getState().panes).map((p) => p.port);
    run.current++;
    await Promise.allSettled(ports.map((port) => monitorService.stop(port)));
    useLogsStore.getState().stopViewing();
  };

  const reconnect = async (key: string) => {
    if (reconnecting.current.has(key)) return;
    reconnecting.current.add(key);
    const r = run.current;
    const s = useLogsStore.getState();
    const pane = s.panes[key];
    s.setNote(key, NOTE.looking);
    try {
      let devices: Device[] = [];
      try {
        devices = await deviceService.detectDevices();
      } catch {
        // A failed scan reads as not found; the person can try again.
      }
      if (r !== run.current) return;
      const serial = pane.device.serialNumber;
      const match = devices.find((d) => !d.inBootloader && (serial ? d.serialNumber === serial : d.path === pane.port));
      if (!match) {
        s.setNote(key, NOTE.notFound);
        return;
      }
      s.setPort(key, match.path);
      // Lines can arrive before start resolves; the marker goes first either way.
      let marked = false;
      const mark = () => {
        if (marked) return;
        marked = true;
        s.appendMarker(key, MARKER.reconnected);
        s.setStatus(key, 'connected');
        s.setNote(key, '');
      };
      try {
        await monitorService.start(match.path, handler(r, key, match.path, mark));
        if (r === run.current) mark();
      } catch {
        if (r === run.current && !marked) s.setNote(key, NOTE.unplugged);
      }
    } finally {
      reconnecting.current.delete(key);
    }
  };

  // Leaving the page while viewing (only possible when the app unmounts) releases every port.
  useEffect(
    () => () => {
      const s = useLogsStore.getState();
      if (!s.viewing) return;
      run.current++;
      for (const pane of Object.values(s.panes)) monitorService.stop(pane.port).catch(() => {});
      s.stopViewing();
    },
    []
  );

  if (!viewing) {
    const blocked = selectedDevices.length === 0 ? 'Choose 1 or 2 devices first.' : null;
    return (
      <>
        <div className="grid max-w-content gap-10">
          <DeviceSelection mode="monitor" selectedDevices={selectedDevices} onDevicesChange={setDevices} />
        </div>
        <ActionBar hint={blocked} hintId="view-blocked">
          <Button size="lg" guardRepeat disabled={!!blocked} aria-describedby={blocked ? 'view-blocked' : undefined} onClick={start}>
            Start Viewing
          </Button>
        </ActionBar>
      </>
    );
  }

  const entries = Object.entries(panes);
  return (
    <>
      {/* Height 0 and a 0px basis (flex-1's 0% acts as auto here) let the panes fill main without growing it, so each log scrolls on its own. */}
      <div className={cn('grid w-full max-w-content gap-6 md:h-0 md:grow md:basis-0 md:grid-rows-1', entries.length > 1 && 'md:grid-cols-2')}>
        {entries.map(([key, pane]) => (
          <Card
            key={key}
            className="flex min-h-0 flex-col"
            title={
              <>
                {BOARD_NAME[pane.device.board]} <span className="code-s font-normal text-ink-muted">{pane.port}</span>
              </>
            }
            actions={
              <span aria-live="polite">
                {pane.status === 'connected' ? (
                  <StatusBadge tone="success">Connected</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Disconnected</StatusBadge>
                )}
              </span>
            }
          >
            <p className={cn('body', pane.note && 'mb-4')} aria-live="polite">{pane.note}</p>
            <LogPane
              lines={pane.lines}
              timestamps={pane.times}
              firstLineNumber={pane.firstLine}
              follow={pane.follow}
              collapsible={false}
              fileName={logFileName(pane)}
              actions={
                <div className="flex flex-wrap gap-target-gap">
                  <Button variant="quiet" onClick={() => setFollow(key, !pane.follow)}>
                    {pane.follow ? 'Pause Scrolling' : 'Resume Scrolling'}
                  </Button>
                  {pane.status === 'disconnected' && (
                    <Button variant="secondary" onClick={() => reconnect(key)}>
                      Reconnect
                    </Button>
                  )}
                </div>
              }
            />
          </Card>
        ))}
      </div>
      <ActionBar>
        <Button size="lg" guardRepeat onClick={stop}>
          Stop Viewing
        </Button>
      </ActionBar>
    </>
  );
}
