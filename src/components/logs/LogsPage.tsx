import { useEffect, useRef, useState, type Ref } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ActionBar } from '@/components/shell/ActionBar';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
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
  openFailed: "Couldn't open the device. Close any other app using it, then select Reconnect.",
  looking: 'Looking for the device…',
  notFound: "Device not found. Check it's plugged in and turned on, then try again.",
};
const MARKER = { disconnected: '--- Disconnected ---', reconnected: '--- Reconnected ---' };
const LEAVE_HINT = 'Logs are cleared when you leave this screen. Copy or save them first.';

const logFileName = (pane: MonitorPane) =>
  `bluebuzzah-${pane.device.board === 'nrf52' ? 'v2' : 'v3'}-${pane.port.split(/[\\/]/).pop()}-log.txt`;

interface DevicePaneProps {
  id: string;
  streaming: boolean;
  /** false while Stop Viewing is closing the ports */
  canReconnect: boolean;
  titleRef?: Ref<HTMLHeadingElement>;
  onReconnect: (key: string) => void;
}

/** One device's log. Subscribes to its own pane only, so a batch for one device doesn't re-render the other. */
function DevicePane({ id, streaming, canReconnect, titleRef, onReconnect }: DevicePaneProps) {
  const pane = useLogsStore((s) => s.panes[id]);
  const setFollow = useLogsStore((s) => s.setFollow);
  const markExported = useLogsStore((s) => s.markExported);
  if (!pane) return null;
  const name = `${BOARD_NAME[pane.device.board]} ${pane.port}`;
  // Two panes announce the same words; this says which device they're about.
  const context = <span className="sr-only">{name}: </span>;
  return (
    <Card
      className="flex min-h-0 flex-col"
      titleRef={titleRef}
      title={
        <>
          {BOARD_NAME[pane.device.board]}{' '}
          {/* Its own line, so the badge can sit beside the board name in a narrow pane. */}
          <span className="code-s block text-ink-muted">{pane.port}</span>
        </>
      }
      actions={
        <span aria-live="polite" aria-atomic="true">
          {context}
          {!streaming ? (
            <StatusBadge tone="neutral">Stopped</StatusBadge>
          ) : pane.status === 'connected' ? (
            <StatusBadge tone="success">Connected</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Disconnected</StatusBadge>
          )}
        </span>
      }
    >
      <p className={cn('body', pane.note && 'mb-4')} aria-live="polite" aria-atomic="true">
        {pane.note && (
          <>
            {context}
            <span>{pane.note}</span>
          </>
        )}
      </p>
      <LogPane
        lines={pane.lines}
        timestamps={pane.times}
        firstLineNumber={pane.firstLine}
        follow={pane.follow}
        collapsible={false}
        label={`${name} log`}
        fileName={logFileName(pane)}
        onExport={(through) => markExported(id, through)}
        actions={
          streaming && (
            <div className="flex flex-wrap gap-target-gap">
              <Button variant="quiet" onClick={() => setFollow(id, !pane.follow)}>
                {pane.follow ? 'Pause Scrolling' : 'Resume Scrolling'}
              </Button>
              {pane.status === 'disconnected' && canReconnect && (
                <Button variant="secondary" onClick={() => onReconnect(id)}>
                  Reconnect
                </Button>
              )}
            </div>
          )
        }
      />
    </Card>
  );
}

/** Logs section: read-only serial output from 1 or 2 devices (Workspace issue #38). */
export function LogsPage() {
  const phase = useLogsStore((s) => s.phase);
  const selectedDevices = useLogsStore((s) => s.selectedDevices);
  const setDevices = useLogsStore((s) => s.setDevices);
  const keys = useLogsStore(useShallow((s) => Object.keys(s.panes)));
  const [stopping, setStopping] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  // Bumped on every start, stop and leave, so a late event or start from an earlier run is ignored.
  const run = useRef(0);
  const reconnecting = useRef(new Set<string>());
  const starting = useRef(new Set<Promise<boolean>>());
  const doneButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'panes' | 'choose' | null>(null);
  const firstTitle = useRef<HTMLHeadingElement>(null);
  const chooseTitle = useRef<HTMLHeadingElement>(null);

  // Like FlashOutcome: a new phase moves focus to its first heading, but only after the person acted.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'panes') firstTitle.current?.focus();
    if (target === 'choose') chooseTitle.current?.focus();
  }, [phase]);

  /** True while this run is streaming and the pane is still on this port. */
  const current = (r: number, key: string, port: string) => {
    const s = useLogsStore.getState();
    return r === run.current && s.phase === 'streaming' && s.panes[key]?.port === port;
  };

  /** Routes one monitor's events to its pane while that monitor is still current. */
  const handler = (r: number, key: string, port: string, onFirst?: () => void) => (event: MonitorEvent) => {
    if (!current(r, key, port)) return;
    const s = useLogsStore.getState();
    onFirst?.();
    if (event.event === 'lines') {
      s.append(key, event.data.lines);
    } else {
      s.appendMarker(key, MARKER.disconnected);
      s.setStatus(key, 'disconnected');
      s.setNote(key, NOTE.unplugged);
    }
  };

  /**
   * Opens a monitor; false if the port couldn't be opened. Ignoring events doesn't stop the
   * backend reader, so a monitor that opens after its run ended (Stop, leave, a new port) is closed again.
   */
  const startMonitor = (r: number, key: string, port: string, onFirst?: () => void) => {
    const opening = (async () => {
      try {
        await monitorService.start(port, handler(r, key, port, onFirst));
      } catch {
        return false;
      }
      if (!current(r, key, port)) await monitorService.stop(port).catch(() => {});
      return true;
    })();
    // Stop Viewing waits for opens still in flight, so the navigation lock lifts only once they've closed again.
    starting.current.add(opening);
    opening.finally(() => starting.current.delete(opening));
    return opening;
  };

  const start = async () => {
    const r = ++run.current;
    focusNext.current = 'panes';
    useLogsStore.getState().startViewing();
    const fresh = useLogsStore.getState().panes;
    await Promise.all(
      Object.entries(fresh).map(async ([key, pane]) => {
        if ((await startMonitor(r, key, pane.port)) || !current(r, key, pane.port)) return;
        const s = useLogsStore.getState();
        s.setStatus(key, 'disconnected');
        s.setNote(key, NOTE.openFailed);
      })
    );
  };

  // Streaming (and the navigation lock) lasts until every port is released.
  const stop = async () => {
    const r = ++run.current;
    setStopping(true);
    const ports = Object.values(useLogsStore.getState().panes).map((p) => p.port);
    await Promise.allSettled([...ports.map((port) => monitorService.stop(port)), ...starting.current]);
    if (r !== run.current) return; // the page was left meanwhile
    setStopping(false);
    useLogsStore.getState().stopViewing();
  };

  const done = () => {
    setConfirmClear(false);
    run.current++;
    focusNext.current = 'choose';
    useLogsStore.getState().leave();
  };

  const reconnect = async (key: string) => {
    if (reconnecting.current.has(key)) return;
    reconnecting.current.add(key);
    const r = run.current;
    const s = useLogsStore.getState();
    s.setNote(key, NOTE.looking);
    try {
      let devices: Device[] = [];
      try {
        devices = await deviceService.detectDevices();
      } catch {
        // A failed scan reads as not found; the person can try again.
      }
      const pane = useLogsStore.getState().panes[key];
      if (r !== run.current || !pane) return;
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
      const opened = await startMonitor(r, key, match.path, mark);
      if (!current(r, key, match.path)) return;
      if (opened) mark();
      else if (!marked) s.setNote(key, NOTE.openFailed);
    } finally {
      reconnecting.current.delete(key);
    }
  };

  // Leaving the page purges the logs. While streaming that's only possible when the app
  // unmounts (navigation is locked), so release every port first.
  useEffect(
    () => () => {
      const s = useLogsStore.getState();
      run.current++;
      if (s.phase === 'streaming') for (const pane of Object.values(s.panes)) monitorService.stop(pane.port).catch(() => {});
      s.leave();
    },
    []
  );

  if (phase === 'choose') {
    const blocked = selectedDevices.length === 0 ? 'Choose 1 or 2 devices first.' : null;
    return (
      <>
        <div className="grid max-w-content gap-10">
          <DeviceSelection mode="monitor" selectedDevices={selectedDevices} onDevicesChange={setDevices} titleRef={chooseTitle} />
        </div>
        <ActionBar hint={blocked} hintId="view-blocked">
          <Button size="lg" guardRepeat disabled={!!blocked} aria-describedby={blocked ? 'view-blocked' : undefined} onClick={start}>
            Start Viewing
          </Button>
        </ActionBar>
      </>
    );
  }

  const streaming = phase === 'streaming';
  const hasUnexported = () =>
    Object.values(useLogsStore.getState().panes).some((p) => p.lines.length > 0 && p.firstLine + p.lines.length - 1 > p.exportedThrough);
  return (
    <>
      {/* Height 0 and a 0px basis (flex-1's 0% acts as auto here) let the panes fill main without growing it, so each log scrolls on its own. */}
      <div className={cn('grid w-full gap-6 md:h-0 md:grow md:basis-0 md:grid-rows-1', keys.length > 1 && 'md:grid-cols-2')}>
        {keys.map((key, i) => (
          <DevicePane key={key} id={key} streaming={streaming} canReconnect={!stopping} titleRef={i === 0 ? firstTitle : undefined} onReconnect={reconnect} />
        ))}
      </div>
      <ActionBar wide hint={streaming ? null : LEAVE_HINT} hintId="logs-leave">
        {/* One Button in one place: React keeps the instance, so its repeat guard stops a double press on Stop Viewing from also pressing Done. */}
        {streaming ? (
          <Button size="lg" guardRepeat onClick={stop}>
            Stop Viewing
          </Button>
        ) : (
          <Button ref={doneButton} size="lg" guardRepeat aria-describedby="logs-leave" onClick={() => (hasUnexported() ? setConfirmClear(true) : done())}>
            Done
          </Button>
        )}
      </ActionBar>
      {/* Done sits where Stop Viewing was pressed, so clearing unsaved logs asks first, with its buttons elsewhere (accessibility.md). */}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear These Logs?"
        cancelLabel="Keep Logs"
        confirmLabel="Clear Logs"
        confirmGuard
        returnFocusRef={doneButton}
        onConfirm={done}
      >
        You haven't copied or saved them. Once cleared, they can't be recovered.
      </ConfirmDialog>
    </>
  );
}
