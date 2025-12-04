import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, X, AlertCircle, Copy, Check } from 'lucide-react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { updaterService, UpdaterError } from '@/services/UpdaterService';
import { useToast } from '@/components/ui/use-toast';
import { extractUpdaterError, getStageDescription } from '@/lib/updater-errors';

export function UpdateDialog() {
  const {
    updateAvailable,
    updateInfo,
    progress,
    error,
    dismissed,
    setProgress,
    setError,
    setChecking,
    dismiss,
    clearError,
  } = useUpdaterStore();

  const { toast } = useToast();
  const [isInstalling, setIsInstalling] = useState(false);
  const [copied, setCopied] = useState(false);

  // Show dialog for updates OR errors
  const showUpdateDialog = updateAvailable && !dismissed && !error;
  const showErrorDialog = error !== null;
  const isOpen = showUpdateDialog || showErrorDialog;

  const handleInstall = async () => {
    setIsInstalling(true);
    setError(null);

    try {
      await updaterService.downloadAndInstall((prog) => {
        setProgress(prog);
      });

      // Update downloaded and ready - relaunch
      await updaterService.relaunchApp();
    } catch (err) {
      // Extract detailed error info
      if (err instanceof UpdaterError) {
        setError(err.info);
      } else {
        setError(extractUpdaterError(err, 'install'));
      }
      setIsInstalling(false);
    }
  };

  const handleSkip = () => {
    dismiss();
  };

  const handleDismissError = () => {
    clearError();
    dismiss();
  };

  const handleRetry = async () => {
    clearError();
    setChecking(true);

    try {
      const updateInfo = await updaterService.checkForUpdate();
      if (updateInfo) {
        useUpdaterStore.getState().setUpdateAvailable(updateInfo);
      } else {
        toast({
          title: 'No Update Available',
          description: 'You are running the latest version.',
        });
      }
    } catch (err) {
      if (err instanceof UpdaterError) {
        setError(err.info);
      } else {
        setError(extractUpdaterError(err, 'check'));
      }
    }
  };

  const handleCopyError = async () => {
    if (!error) return;

    const errorText = `BlueBuzzah Updater Error
Stage: ${getStageDescription(error.stage)}
Message: ${error.message}

Details:
${error.details}`;

    try {
      await navigator.clipboard.writeText(errorText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: 'Copied',
        description: 'Error details copied to clipboard.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy Failed',
        description: 'Could not copy to clipboard.',
      });
    }
  };

  // Only return null if there's nothing to show
  if (!updateInfo && !error) return null;

  const isDownloading = progress?.stage === 'downloading';
  const progressPercent = progress?.percent ?? 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Render error dialog
  if (showErrorDialog && error) {
    return (
      <AlertDialog open={true}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Update Failed
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-foreground">
                  An error occurred while {getStageDescription(error.stage)}.
                </p>

                <div className="rounded border border-destructive/30 bg-destructive/10 p-3">
                  <p className="font-medium text-destructive">{error.message}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Technical Details:
                  </p>
                  <div className="max-h-40 overflow-auto rounded border border-border bg-secondary/50 p-3 font-mono text-xs">
                    <pre className="whitespace-pre-wrap break-all text-muted-foreground">
                      {error.details}
                    </pre>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleDismissError}>
              <X className="mr-2 h-4 w-4" />
              Dismiss
            </Button>
            <Button variant="outline" onClick={handleCopyError}>
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Details
                </>
              )}
            </Button>
            <Button
              onClick={handleRetry}
              className="bg-[#35B6F2] hover:bg-[#35B6F2]/90"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Render update available dialog
  if (!updateInfo) return null;

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-[#35B6F2]" />
            Update Available
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Version{' '}
                <span className="font-semibold text-foreground">
                  {updateInfo.version}
                </span>{' '}
                is available. You are currently on version{' '}
                {updateInfo.currentVersion}.
              </p>

              {updateInfo.releaseDate && (
                <p className="text-xs text-muted-foreground">
                  Released:{' '}
                  {new Date(updateInfo.releaseDate).toLocaleDateString()}
                </p>
              )}

              <div className="max-h-48 overflow-y-auto rounded border border-border bg-secondary/50 p-3 text-sm">
                <p className="mb-2 font-medium">Release Notes:</p>
                <div
                  className="prose prose-sm prose-invert max-w-none
                    prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                    prose-p:text-muted-foreground prose-p:my-1
                    prose-ul:text-muted-foreground prose-ul:my-1 prose-ul:pl-4
                    prose-ol:text-muted-foreground prose-ol:my-1 prose-ol:pl-4
                    prose-li:my-0.5
                    prose-code:text-[#35B6F2] prose-code:bg-secondary prose-code:px-1 prose-code:rounded prose-code:text-xs
                    prose-pre:bg-secondary prose-pre:p-2 prose-pre:rounded prose-pre:my-2
                    prose-a:text-[#35B6F2] prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-foreground"
                >
                  <ReactMarkdown>{updateInfo.releaseNotes}</ReactMarkdown>
                </div>
              </div>

              {isDownloading && progress && (
                <div className="space-y-2">
                  <Progress value={progressPercent} className="h-2" />
                  <p className="text-center text-xs text-muted-foreground">
                    {formatBytes(progress.downloaded)} /{' '}
                    {formatBytes(progress.total)} ({progressPercent}%)
                  </p>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={handleSkip} disabled={isInstalling}>
            <X className="mr-2 h-4 w-4" />
            Skip
          </Button>
          <Button
            onClick={handleInstall}
            disabled={isInstalling}
            className="bg-[#35B6F2] hover:bg-[#35B6F2]/90"
          >
            {isInstalling ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {isDownloading ? 'Downloading...' : 'Installing...'}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Install Update
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
