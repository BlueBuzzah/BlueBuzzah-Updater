import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { formatBytes, formatDate, truncateText } from '@/lib/utils';
import { firmwareService } from '@/services/FirmwareService';
import { FirmwareRelease } from '@/types';
import { Calendar, ChevronDown, ChevronUp, Download, FileText, HardDrive, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface FirmwareSelectionProps {
  onSelect: (release: FirmwareRelease) => void;
}

export function FirmwareSelection({
  onSelect,
}: FirmwareSelectionProps) {
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedReleases, setExpandedReleases] = useState<Set<string>>(
    new Set()
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [releaseToDelete, setReleaseToDelete] = useState<FirmwareRelease | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadReleases();
  }, []);

  const loadReleases = async () => {
    try {
      setLoading(true);
      const data = await firmwareService.fetchReleases();
      setReleases(data);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to load firmware releases',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (tagName: string) => {
    setExpandedReleases((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) {
        next.delete(tagName);
      } else {
        next.add(tagName);
      }
      return next;
    });
  };

  const handleDeleteClick = (release: FirmwareRelease, e: React.MouseEvent) => {
    e.stopPropagation();
    setReleaseToDelete(release);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!releaseToDelete) return;

    try {
      setIsDeleting(true);
      await firmwareService.deleteCachedFirmware(releaseToDelete.version);

      toast({
        title: 'Cache deleted',
        description: `Deleted cached firmware for ${releaseToDelete.version}`,
      });

      // Reload releases to update cache status
      await loadReleases();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to delete cached firmware',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setReleaseToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-secondary rounded w-1/3 mx-auto" />
            <div className="h-4 bg-secondary rounded w-1/2 mx-auto" />
          </div>
          <p className="mt-4 text-muted-foreground">
            Loading firmware releases...
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-secondary rounded w-1/2" />
                <div className="h-4 bg-secondary rounded w-1/3 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="h-4 bg-secondary rounded" />
                  <div className="h-4 bg-secondary rounded w-5/6" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Releases Found</h3>
        <p className="text-muted-foreground mb-4">
          Unable to find any firmware releases
        </p>
        <Button onClick={loadReleases}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Select Firmware Version</h2>
        <p className="text-muted-foreground">
          Choose the firmware version you want to install
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {releases.map((release, index) => {
          const isExpanded = expandedReleases.has(release.tagName);
          const truncatedNotes = truncateText(release.releaseNotes, 150);
          const needsExpansion = release.releaseNotes.length > 150;

          return (
            <Card
              key={release.tagName}
              className={`transition-all hover:shadow-lg ${
                release.isCached
                  ? 'border-primary/50 shadow-[0_0_15px_rgba(53,182,242,0.15)]'
                  : ''
              }`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2 flex-wrap">
                      {release.version}
                      {index === 0 && (
                        <Badge variant="default">Latest</Badge>
                      )}
                      {release.isCached && (
                        <Badge
                          variant="default"
                          className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/30"
                        >
                          <HardDrive className="h-3 w-3 mr-1" />
                          Cached
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-2">
                      <Calendar className="h-3 w-3" />
                      {formatDate(release.publishedAt)}
                    </CardDescription>
                    {release.isCached && release.cachedMetadata && (
                      <CardDescription className="flex items-center gap-2 mt-1 text-xs">
                        <HardDrive className="h-3 w-3" />
                        Downloaded {formatDate(new Date(release.cachedMetadata.downloaded_at))} •{' '}
                        {formatBytes(release.cachedMetadata.file_size)}
                      </CardDescription>
                    )}
                  </div>
                  {release.isCached && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={(e) => handleDeleteClick(release, e)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold mb-1">Release Notes</h4>
                  <p className="text-sm text-muted-foreground">
                    {isExpanded ? release.releaseNotes : truncatedNotes}
                  </p>
                  {needsExpansion && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-auto p-0 text-xs"
                      onClick={() => toggleExpanded(release.tagName)}
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3 w-3 mr-1" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3 w-3 mr-1" />
                          Read more
                        </>
                      )}
                    </Button>
                  )}
                </div>

                <Separator />

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Download Size</span>
                  <span className="font-medium">
                    {release.assets.length > 0
                      ? formatBytes(release.assets[0].size)
                      : 'N/A'}
                  </span>
                </div>
              </CardContent>

              <CardFooter>
                <Button
                  className="w-full"
                  onClick={() => onSelect(release)}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Install {release.version}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cached Firmware</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the cached firmware for{' '}
              <span className="font-semibold text-foreground">
                {releaseToDelete?.version}
              </span>
              ? This will remove the downloaded files from your computer. You can
              always download it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
