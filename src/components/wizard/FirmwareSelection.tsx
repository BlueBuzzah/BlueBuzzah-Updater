import { useCallback, useEffect, useId, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
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

/** updater.md step 2: latest stable preselected, experimental versions behind a labeled toggle. */
export function FirmwareSelection({ value, onChange, board }: FirmwareSelectionProps) {
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showExperimental, setShowExperimental] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const notesId = useId();

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
    if (value && shown.some((r) => r.tagName === value.tagName)) return;
    const target = latestStable ?? shown[0] ?? null;
    if (target?.tagName !== value?.tagName) onChange(target);
  });

  const deleteDownload = async () => {
    if (!value) return;
    for (const entry of value.cachedEntries ?? []) {
      await firmwareService.deleteCachedFirmware(entry.version, entry.board);
    }
    await load();
  };

  const sizeOf = (r: FirmwareRelease) => {
    const asset = board ? getAssetForBoard(r, board) : null;
    return asset ? `${formatBytes(asset.size)} download` : null;
  };

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
      <div className="grid gap-6">
        <p className="body-s text-ink-muted" aria-live="polite">{loading ? 'Loading firmware versions…' : ''}</p>
        {releases.some((r) => r.isPrerelease) && (
          <Switch
            label="Show experimental versions"
            description="Early builds for testing. They may have bugs."
            checked={showExperimental}
            onChange={setShowExperimental}
          />
        )}
        {shown.length > 0 && (
          <ChoiceGroup
            label="Choose a version"
            value={value?.tagName ?? null}
            onChange={(tag) => {
              setNotesOpen(false);
              onChange(shown.find((r) => r.tagName === tag) ?? null);
            }}
            options={shown.map((r) => ({
              value: r.tagName,
              title: <code className="code">{r.version}</code>,
              badge: (
                <span className="flex flex-wrap gap-2">
                  {r === latestStable && <StatusBadge>Latest</StatusBadge>}
                  {r.isPrerelease && <StatusBadge tone="warning">Experimental</StatusBadge>}
                  {r.isCached && <StatusBadge>Downloaded</StatusBadge>}
                </span>
              ),
              body: [`Released ${formatDate(r.publishedAt)}`, sizeOf(r)].filter(Boolean).join(' · '),
            }))}
          />
        )}
        {value && (
          <div className="flex flex-wrap items-start justify-between gap-target-gap">
            {value.releaseNotes && (
              <Button
                variant="quiet"
                icon={notesOpen ? ChevronUp : ChevronDown}
                aria-expanded={notesOpen}
                aria-controls={notesId}
                onClick={() => setNotesOpen(!notesOpen)}
              >
                {notesOpen ? 'Hide release notes' : 'Show release notes'}
              </Button>
            )}
            {value.isCached && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete download
              </Button>
            )}
          </div>
        )}
        {value && notesOpen && (
          <div id={notesId} className="release-notes">
            <ReactMarkdown>{value.releaseNotes}</ReactMarkdown>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this download?"
        cancelLabel="Keep it"
        confirmLabel="Delete"
        onConfirm={deleteDownload}
      >
        Firmware {value?.version} will be removed from this computer. You can download it again any time.
      </ConfirmDialog>
    </Card>
  );
}
