import { useCallback, useEffect, useId, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import { formatBytes, formatDate } from '@/lib/utils';
import { firmwareService, getAssetForBoard } from '@/services/FirmwareService';
import type { BoardType, FirmwareRelease } from '@/types';

interface FirmwareSelectionProps {
  value: FirmwareRelease | null;
  onChange: (release: FirmwareRelease | null) => void;
  /** Board of the chosen devices, to show the right download size */
  board?: BoardType;
}

/**
 * updater.md step 2: latest stable preselected, experimental versions behind a
 * labeled toggle. The page shows only the chosen version; every version is
 * listed in a dialog (owner's design, 2026-10-28).
 */
export function FirmwareSelection({ value, onChange, board }: FirmwareSelectionProps) {
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showExperimental, setShowExperimental] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FirmwareRelease | null>(null);
  const [deleteStatus, setDeleteStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setReleases(await firmwareService.fetchReleases());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = releases.filter((r) => showExperimental || !r.isPrerelease);
  const latestStable = releases.find((r) => !r.isPrerelease) ?? null;

  // Keep a visible choice: the newest stable when nothing (or a hidden one) is chosen.
  useEffect(() => {
    if (loading) return;
    // After a reload (e.g. a deleted download), switch to the fresh copy of the same version.
    const fresh = value && shown.find((r) => r.tagName === value.tagName);
    if (fresh) {
      if (fresh !== value) onChange(fresh);
      return;
    }
    const target = latestStable ?? shown[0] ?? null;
    if (target?.tagName !== value?.tagName) onChange(target);
  });

  const deleteDownload = async () => {
    if (!toDelete) return;
    setDeleteStatus('');
    try {
      for (const entry of toDelete.cachedEntries ?? []) {
        await firmwareService.deleteCachedFirmware(entry.version, entry.board);
      }
      await load();
    } catch {
      setDeleteStatus("Couldn't delete the download.");
    }
  };

  const details = (r: FirmwareRelease) => {
    const asset = board ? getAssetForBoard(r, board) : null;
    return [`Released ${formatDate(r.publishedAt)}`, asset && `${formatBytes(asset.size)} download`].filter(Boolean).join(' · ');
  };

  const badges = (r: FirmwareRelease) => (
    <span className="flex flex-wrap gap-2">
      {r === latestStable && <StatusBadge tone="success">Latest</StatusBadge>}
      {r.isPrerelease && <StatusBadge tone="warning">Experimental</StatusBadge>}
      {r.isCached && <StatusBadge>Downloaded</StatusBadge>}
    </span>
  );

  if (!loading && (loadError || releases.length === 0)) {
    return (
      <Card title="Choose a version">
        <div className="grid gap-4">
          <h4 className="display-l">No firmware found</h4>
          <p className="body">We couldn't reach the firmware list on GitHub. Check your internet connection, then select Try again.</p>
          {loadError && <p className="code-s rounded-xs bg-surface-sunken p-2">{loadError}</p>}
          <div>
            <Button variant="secondary" onClick={load}>Try again</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Choose a version">
      <DialogPrimitive.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        {loading ? (
          <p className="body-s text-ink-muted" aria-live="polite">Loading firmware versions…</p>
        ) : (
          value && (
            <div className="flex flex-wrap items-center justify-between gap-target-gap">
              <div className="grid gap-2">
                <code className="code">{value.version}</code>
                {badges(value)}
                <p className="body-s text-ink-muted">{details(value)}</p>
              </div>
              <DialogPrimitive.Trigger asChild>
                <Button variant="secondary">Change version</Button>
              </DialogPrimitive.Trigger>
            </div>
          )
        )}

        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100%-var(--space-8))] w-full max-w-prose -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_auto_1fr_auto] gap-6 rounded-xl bg-surface-overlay p-8 text-ink shadow-3"
          >
            <DialogPrimitive.Title className="title-l">Choose a version</DialogPrimitive.Title>
            {releases.some((r) => r.isPrerelease) ? (
              <Switch
                label="Show experimental versions"
                description="Early builds for testing. They may have bugs."
                checked={showExperimental}
                onChange={setShowExperimental}
              />
            ) : (
              <span />
            )}
            <ul className="grid min-h-0 content-start gap-3 overflow-y-auto">
              {shown.map((r) => (
                <VersionRow
                  key={r.tagName}
                  release={r}
                  chosen={r.tagName === value?.tagName}
                  badges={badges(r)}
                  details={details(r)}
                  notesOpen={notesFor === r.tagName}
                  onToggleNotes={() => setNotesFor(notesFor === r.tagName ? null : r.tagName)}
                  onChoose={() => {
                    onChange(r);
                    setPickerOpen(false);
                  }}
                  onDelete={() => setToDelete(r)}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-target-gap">
              <p className="body-s" aria-live="polite">{deleteStatus}</p>
              <DialogPrimitive.Close asChild>
                <Button variant="quiet">Close</Button>
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this download?"
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onConfirm={deleteDownload}
      >
        Firmware {toDelete?.version} will be removed from this computer. You can download it again any time.
      </ConfirmDialog>
    </Card>
  );
}

interface VersionRowProps {
  release: FirmwareRelease;
  chosen: boolean;
  badges: React.ReactNode;
  details: string;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onChoose: () => void;
  onDelete: () => void;
}

/** One version in the picker: number, badges, Release notes, Choose and (when downloaded) Delete download. */
function VersionRow({ release: r, chosen, badges, details, notesOpen, onToggleNotes, onChoose, onDelete }: VersionRowProps) {
  const titleId = useId();
  const notesId = useId();
  return (
    <li
      aria-labelledby={titleId}
      className={`grid gap-3 rounded-lg border-control p-4 ${chosen ? 'border-brand bg-brand-soft' : 'border-line-strong'}`}
    >
      <div className="grid gap-2">
        <span id={titleId} className="sr-only">Version {r.version}</span>
        <code className="code">{r.version}</code>
        <span className="flex flex-wrap gap-2">
          {chosen && <StatusBadge tone="brand">Chosen</StatusBadge>}
          {badges}
        </span>
        <p className="body-s text-ink-muted">{details}</p>
      </div>
      <div className="flex flex-wrap gap-target-gap">
        {r.releaseNotes && (
          <Button variant="quiet" icon={notesOpen ? ChevronUp : ChevronDown} aria-expanded={notesOpen} aria-controls={notesId} onClick={onToggleNotes}>
            Release notes
          </Button>
        )}
        {!chosen && (
          <Button variant="secondary" aria-label={`Choose version ${r.version}`} onClick={onChoose}>
            Choose
          </Button>
        )}
        {r.isCached && (
          <Button variant="danger" icon={Trash2} aria-label={`Delete download of version ${r.version}`} onClick={onDelete}>
            Delete download
          </Button>
        )}
      </div>
      {notesOpen && (
        <div id={notesId} className="release-notes">
          <ReactMarkdown>{r.releaseNotes}</ReactMarkdown>
        </div>
      )}
    </li>
  );
}
