import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { ArrowLeft, Check } from 'lucide-react';
import React from 'react';

interface WizardStep {
  id: number;
  label: string;
  description: string;
}

const steps: WizardStep[] = [
  {
    id: 0,
    label: 'Profile',
    description: 'Select profile',
  },
  {
    id: 1,
    label: 'Devices',
    description: 'Select devices',
  },
  {
    id: 2,
    label: 'Configure',
    description: 'Apply settings',
  },
];

interface TherapyWizardLayoutProps {
  currentStep: number;
  canGoNext: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onBack: () => void;
  onBackToHome: () => void;
  children: React.ReactNode;
}

export function TherapyWizardLayout({
  currentStep,
  canGoNext,
  canGoBack,
  onNext,
  onBack,
  onBackToHome,
  children,
}: TherapyWizardLayoutProps) {
  const isProfileSelection = currentStep === 0;
  const isConfiguring = currentStep === 2;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBackToHome}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Home
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <h1 className="text-2xl font-bold">Configure Devices</h1>
              <p className="text-sm text-muted-foreground">
                Configure device therapy settings
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Step Indicator */}
      <div className="border-b bg-muted/20">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            {steps.map((step, index) => {
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;

              return (
                <React.Fragment key={step.id}>
                  <div className="flex flex-col items-center gap-2 flex-1">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all',
                        isActive &&
                          'bg-primary text-primary-foreground ring-4 ring-primary/20',
                        isCompleted && 'bg-primary text-primary-foreground',
                        !isActive &&
                          !isCompleted &&
                          'bg-muted text-muted-foreground'
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        step.id + 1
                      )}
                    </div>
                    <div className="text-center">
                      <p
                        className={cn(
                          'text-sm font-medium',
                          isActive && 'text-foreground',
                          !isActive && 'text-muted-foreground'
                        )}
                      >
                        {step.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </div>

                  {index < steps.length - 1 && (
                    <Separator
                      orientation="horizontal"
                      className={cn(
                        'flex-1 mx-4 mt-[-2rem]',
                        isCompleted && currentStep > step.id
                          ? 'bg-primary'
                          : 'bg-muted'
                      )}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">{children}</div>
      </main>

      {/* Footer Navigation */}
      {!isProfileSelection && !isConfiguring && (
        <footer className="border-t bg-muted/20">
          <div className="container mx-auto px-6 py-4">
            <div className="flex justify-between max-w-4xl mx-auto">
              <Button variant="outline" onClick={onBack} disabled={!canGoBack}>
                Back
              </Button>
              <Button onClick={onNext} disabled={!canGoNext}>
                Configure Devices
              </Button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
