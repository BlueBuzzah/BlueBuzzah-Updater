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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { formatBytes, formatDate } from '@/lib/utils';
import { firmwareService } from '@/services/FirmwareService';
import { FirmwareRelease } from '@/types';
import { Calendar, ChevronDown, ChevronUp, Download, FileText, HardDrive, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

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
                      {release.isPrerelease && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">
                                <Badge
                                  variant="default"
                                  className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30"
                                >
                                  Experimental
                                </Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              className="max-w-xs bg-zinc-900 border border-amber-500/30 shadow-lg shadow-amber-500/5"
                              sideOffset={8}
                            >
                              <p className="font-semibold text-amber-400 text-sm">
                                Warning: Experimental Firmware
                              </p>
                              <p className="text-zinc-300 text-xs mt-1.5 leading-relaxed">
                                Pre-release version for testing and evaluation. Not intended for regular therapy use. May contain defects or unexpected behavior.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
                  <div className="relative">
                    <div
                      className={`prose prose-sm prose-invert max-w-none overflow-hidden transition-all duration-200
                        prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                        prose-p:text-muted-foreground prose-p:my-1
                        prose-ul:text-muted-foreground prose-ul:my-1 prose-ul:pl-4
                        prose-ol:text-muted-foreground prose-ol:my-1 prose-ol:pl-4
                        prose-li:my-0.5
                        prose-code:text-[#35B6F2] prose-code:bg-secondary prose-code:px-1 prose-code:rounded prose-code:text-xs
                        prose-pre:bg-secondary prose-pre:p-2 prose-pre:rounded prose-pre:my-2
                        prose-a:text-[#35B6F2] prose-a:no-underline hover:prose-a:underline
                        prose-strong:text-foreground
                        ${isExpanded ? 'max-h-[500px]' : 'max-h-[4.5rem]'}`}
                    >
                      <ReactMarkdown>{release.releaseNotes}</ReactMarkdown>
                    </div>
                    {!isExpanded && needsExpansion && (
                      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                    )}
                  </div>
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
