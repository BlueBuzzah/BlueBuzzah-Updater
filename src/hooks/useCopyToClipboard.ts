import { useToast } from '@/components/ui/use-toast';

export function useCopyToClipboard() {
  const { toast } = useToast();

  const copyToClipboard = async (text: string, contentLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: 'Logs copied',
        description: `${contentLabel} have been copied to clipboard`,
      });
    } catch (err) {
      console.warn('Clipboard write failed:', err);
      toast({
        variant: 'destructive',
        title: 'Copy Failed',
        description: 'Could not copy to clipboard.',
      });
    }
  };

  return { copyToClipboard };
}
