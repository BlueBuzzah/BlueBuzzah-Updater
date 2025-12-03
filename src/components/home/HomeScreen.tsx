import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Download, Settings } from 'lucide-react';

export type AppMode = 'home' | 'firmware' | 'therapy';

interface HomeScreenProps {
  onSelectMode: (mode: AppMode) => void;
}

export function HomeScreen({ onSelectMode }: HomeScreenProps) {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 py-6">
          <h1 className="text-3xl font-bold">BlueBuzzah Updater</h1>
          <p className="text-muted-foreground mt-1">
            Manage firmware and settings for your BlueBuzzah devices
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold mb-2">What would you like to do?</h2>
            <p className="text-muted-foreground">
              Select an option to get started
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Firmware Update Card */}
            <Card
              className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 group"
              onClick={() => onSelectMode('firmware')}
            >
              <CardHeader>
                <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Download className="h-7 w-7 text-primary" />
                </div>
                <CardTitle className="text-xl">Firmware Update</CardTitle>
                <CardDescription>
                  Install the latest firmware version to your devices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Download firmware from GitHub</li>
                  <li>• Update up to 2 devices at once</li>
                  <li>• Configure device roles</li>
                </ul>
              </CardContent>
            </Card>

            {/* Therapy Profile Card */}
            <Card
              className="cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 group"
              onClick={() => onSelectMode('therapy')}
            >
              <CardHeader>
                <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Settings className="h-7 w-7 text-primary" />
                </div>
                <CardTitle className="text-xl">Set Therapy Profile</CardTitle>
                <CardDescription>
                  Configure the vibration pattern for your devices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Noisy - Randomized therapeutic pattern</li>
                  <li>• Standard - Consistent full intensity</li>
                  <li>• Gentle - Reduced intensity</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-4">
        <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
          BlueBuzzah Updater {appVersion && `v${appVersion}`}
        </div>
      </footer>
    </div>
  );
}
