import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { THERAPY_PROFILES } from '@/lib/therapy-profiles';
import type { TherapyProfile } from '@/types';
import {
	Activity,
	CheckCircle2,
	Feather,
	Gauge,
	Shuffle,
} from 'lucide-react';

interface ProfileSelectionProps {
  selectedProfile: TherapyProfile | null;
  onSelect: (profile: TherapyProfile) => void;
}

const profileIcons: Record<TherapyProfile, React.ReactNode> = {
  REGULAR: <Gauge className="h-8 w-8 text-primary" />,
  NOISY: <Activity className="h-8 w-8 text-primary" />,
  HYBRID: <Shuffle className="h-8 w-8 text-primary" />,
  GENTLE: <Feather className="h-8 w-8 text-primary" />,
};

export function ProfileSelection({
  selectedProfile,
  onSelect,
}: ProfileSelectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Select Therapy Profile</h2>
        <p className="text-muted-foreground">
          Choose a vibration pattern for your devices
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {THERAPY_PROFILES.map((profile) => {
          const isSelected = selectedProfile === profile.id;

          return (
            <Card
              key={profile.id}
              className={`transition-all cursor-pointer hover:shadow-lg hover:border-primary/50 group ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => onSelect(profile.id)}
            >
              <CardHeader className="text-center pb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1" />
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    {profileIcons[profile.id]}
                  </div>
                  <div className="flex-1 flex justify-end">
                    {isSelected && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </div>
                <CardTitle className="text-lg">{profile.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <CardDescription className="text-sm">
                  {profile.description}
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">Profile Details:</p>
            <ul className="space-y-2">
              <li>
                <span className="font-medium">Regular:</span> Default vCR pattern
                with consistent, non-mirrored stimulation
              </li>
              <li>
                <span className="font-medium">Noisy:</span> Mirrored pattern with
                23.5% jitter for varied, unpredictable stimulation
              </li>
              <li>
                <span className="font-medium">Hybrid:</span> Non-mirrored pattern
                with 23.5% jitter combining consistency with variation
              </li>
              <li>
                <span className="font-medium">Gentle:</span> Lower amplitude with
                sequential pattern for sensitive users
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
