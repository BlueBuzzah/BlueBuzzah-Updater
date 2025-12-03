import { useState } from 'react';
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
import { Download, RefreshCw, X } from 'lucide-react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { updaterService } from '@/services/UpdaterService';
import { useToast } from '@/components/ui/use-toast';

export function UpdateDialog() {
  const {
    updateAvailable,
    updateInfo,
    progress,
    error,
    dismissed,
    setProgress,
    setError,
    dismiss,
  } = useUpdaterStore();

  const { toast } = useToast();
  const [isInstalling, setIsInstalling] = useState(false);

  const isOpen = updateAvailable && !dismissed && !error;

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
      const errorMessage = err instanceof Error ? err.message : 'Update failed';
      setError(errorMessage);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: errorMessage,
      });
      setIsInstalling(false);
    }
  };

  const handleSkip = () => {
    dismiss();
  };

  if (!updateInfo) return null;

  const isDownloading = progress?.stage === 'downloading';
  const progressPercent = progress?.percent ?? 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

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

              <div className="max-h-32 overflow-y-auto rounded border border-border bg-secondary/50 p-3 text-sm">
                <p className="mb-1 font-medium">Release Notes:</p>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {updateInfo.releaseNotes}
                </p>
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
