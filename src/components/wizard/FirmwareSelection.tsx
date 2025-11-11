import { useEffect, useState } from 'react';
import { Download, Calendar, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { firmwareService } from '@/services/FirmwareService';
import { FirmwareRelease } from '@/types';
import { formatBytes, formatDate, truncateText } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Separator } from '@/components/ui/separator';

interface FirmwareSelectionProps {
  onSelect: (release: FirmwareRelease) => void;
  selectedRelease: FirmwareRelease | null;
}

export function FirmwareSelection({
  onSelect,
  selectedRelease,
}: FirmwareSelectionProps) {
  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedReleases, setExpandedReleases] = useState<Set<string>>(
    new Set()
  );
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
        <div className="grid gap-4 md:grid-cols-2">
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

      <div className="grid gap-4 md:grid-cols-2">
        {releases.map((release, index) => {
          const isExpanded = expandedReleases.has(release.tagName);
          const isSelected = selectedRelease?.tagName === release.tagName;
          const truncatedNotes = truncateText(release.releaseNotes, 150);
          const needsExpansion = release.releaseNotes.length > 150;

          return (
            <Card
              key={release.tagName}
              className={`transition-all hover:shadow-lg ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {release.version}
                      {index === 0 && (
                        <Badge variant="default">Latest</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-2">
                      <Calendar className="h-3 w-3" />
                      {formatDate(release.publishedAt)}
                    </CardDescription>
                  </div>
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
                  variant={isSelected ? 'secondary' : 'default'}
                  onClick={() => onSelect(release)}
                >
                  {isSelected ? (
                    'Selected'
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Select Version
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
