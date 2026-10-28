import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Copy, Download, RotateCcw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { extractUpdaterError, getStageDescription } from '@/lib/updater-errors';
import { updaterService, UpdaterError } from '@/services/UpdaterService';
import { useIsBusy } from '@/stores/busy';
import { useUpdaterStore } from '@/stores/updaterStore';

/** Offers an update of the Updater itself (not firmware). Held while a flash or setup runs. */
export function UpdateDialog() {
  const { updateAvailable, updateInfo, progress, error, dismissed, setProgress, setError, setChecking, setUpdateAvailable, dismiss, clearError } =
    useUpdaterStore();
  const { busy } = useIsBusy();
  const [isInstalling, setIsInstalling] = useState(false);
  const [copied, setCopied] = useState('');

  // Never offer a relaunch while a flash or setup runs (updater.md)
  const isOpen = !busy && ((updateAvailable && !dismissed && !error) || error !== null);
  if (!updateInfo && !error) return null;

  const install = async () => {
    setIsInstalling(true);
    setError(null);
    try {
      await updaterService.downloadAndInstall(setProgress);
      await updaterService.relaunchApp();
    } catch (err) {
      setError(err instanceof UpdaterError ? err.info : extractUpdaterError(err, 'install'));
      setIsInstalling(false);
    }
  };

  const recheck = async () => {
    clearError();
    setChecking(true);
    try {
      setUpdateAvailable(await updaterService.checkForUpdate());
    } catch (err) {
      setError(err instanceof UpdaterError ? err.info : extractUpdaterError(err, 'check'));
    }
  };

  // Retry the step that failed (open question O-7).
  const retry = () => (error?.stage === 'check' ? recheck() : install());

  const copyDetails = async () => {
    if (!error) return;
    try {
      await navigator.clipboard.writeText(
        `BlueBuzzah Updater error\nStage: ${getStageDescription(error.stage)}\nMessage: ${error.message}\nDetails:\n${error.details}`
      );
      setCopied('Details copied.');
    } catch {
      setCopied("Couldn't copy the details.");
    }
  };

  const downloading = progress?.stage === 'downloading';

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        {error ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>The update didn&apos;t install</AlertDialogTitle>
              <AlertDialogDescription>Check your internet connection, then select Try again.</AlertDialogDescription>
            </AlertDialogHeader>
            <p className="code-s whitespace-pre-wrap rounded-md bg-surface-sunken p-4">
              {getStageDescription(error.stage)}: {error.message}
            </p>
            <p className="body-s" aria-live="polite">{copied}</p>
            <AlertDialogFooter>
              <Button
                variant="quiet"
                onClick={() => {
                  clearError();
                  dismiss();
                }}
              >
                Close
              </Button>
              <div className="flex flex-wrap gap-target-gap">
                <Button variant="secondary" icon={Copy} onClick={copyDetails}>
                  Copy details
                </Button>
                <Button icon={RotateCcw} guardRepeat onClick={retry}>
                  Try again
                </Button>
              </div>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>A new BlueBuzzah Updater is ready</AlertDialogTitle>
              <AlertDialogDescription>
                Version <code className="code">{updateInfo?.version}</code> is ready. You have{' '}
                <code className="code">{updateInfo?.currentVersion}</code>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {updateInfo?.releaseNotes && (
              <div className="grid gap-2">
                <p className="label">What&apos;s new</p>
                <div className="release-notes max-h-full overflow-y-auto">
                  <ReactMarkdown>{updateInfo.releaseNotes}</ReactMarkdown>
                </div>
              </div>
            )}
            {downloading && <ProgressBar label="Downloading the update" value={progress?.percent ?? 0} />}
            <AlertDialogFooter>
              <Button variant="quiet" onClick={dismiss} disabled={isInstalling}>
                Not now
              </Button>
              <Button icon={Download} guardRepeat onClick={install} disabled={isInstalling}>
                Install and restart
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
