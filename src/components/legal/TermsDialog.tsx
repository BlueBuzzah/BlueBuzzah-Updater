import { ExternalLink } from 'lucide-react';
import { open } from '@tauri-apps/plugin-shell';
import { exit } from '@tauri-apps/plugin-process';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { IMPLANT_NOTICE, MEDICAL_DISCLAIMER, PRIVACY_URL, TERMS_EFFECTIVE_DATE, TERMS_URL } from '@/lib/legal';
import { useSettingsStore } from '@/stores/settingsStore';

/** Links to the Terms and Safety page and the privacy policy, opened in the browser. */
export function LegalLinks() {
  return (
    <div className="flex flex-wrap gap-target-gap">
      <Button variant="quiet" iconEnd={ExternalLink} onClick={() => open(TERMS_URL)}>
        Terms and Safety
      </Button>
      <Button variant="quiet" iconEnd={ExternalLink} onClick={() => open(PRIVACY_URL)}>
        Privacy Policy
      </Button>
    </div>
  );
}

/** First-launch gate: shown until the person agrees to the current Terms. Escape and the scrim do nothing. */
export function TermsDialog({ open: isOpen }: { open: boolean }) {
  const setSettings = useSettingsStore((s) => s.setSettings);
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Before You Start</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-4">
              <p>The BlueBuzzah Updater installs firmware on devices you built yourself. Read these notes, then agree to continue.</p>
              <p>{MEDICAL_DISCLAIMER}</p>
              <p>
                <strong>Important:</strong>
                {IMPLANT_NOTICE.slice('Important:'.length)}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <LegalLinks />
        <AlertDialogFooter>
          <Button variant="quiet" onClick={() => exit(0)}>
            Quit
          </Button>
          <Button variant="primary" onClick={() => setSettings({ termsAcceptedDate: TERMS_EFFECTIVE_DATE })}>
            I Agree
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
