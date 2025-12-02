import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardLayout } from './WizardLayout';

describe('WizardLayout', () => {
  const mockOnNext = vi.fn();
  const mockOnBack = vi.fn();
  const mockOnBackToHome = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Header', () => {
    it('renders app title', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Firmware Update')).toBeInTheDocument();
    });

    it('renders app subtitle', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Firmware update tool for BlueBuzzah devices')).toBeInTheDocument();
    });

    it('renders Home button', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
    });

    it('clicking Home calls onBackToHome', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /home/i }));
      expect(mockOnBackToHome).toHaveBeenCalledTimes(1);
    });
  });

  describe('Step Indicator', () => {
    it('renders all step labels', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Firmware')).toBeInTheDocument();
      expect(screen.getByText('Devices')).toBeInTheDocument();
      expect(screen.getByText('Install')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    it('renders step descriptions', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Select version')).toBeInTheDocument();
      expect(screen.getByText('Select devices')).toBeInTheDocument();
      expect(screen.getByText('Install firmware')).toBeInTheDocument();
      expect(screen.getByText('Finish')).toBeInTheDocument();
    });

    it('shows step numbers', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  describe('Current Step Styling', () => {
    it('highlights current step at 0', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      // Step 1 should have primary background (active state)
      const stepIndicators = document.querySelectorAll('.rounded-full');
      expect(stepIndicators[0]).toHaveClass('bg-primary');
    });

    it('highlights current step at 1', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      // At step 1, the second indicator should be active
      // And the first step should be completed
      const stepIndicators = document.querySelectorAll('.rounded-full');

      // First step should have bg-primary (completed state)
      expect(stepIndicators[0]).toHaveClass('bg-primary');
      // Second step (current) should also have bg-primary and ring styling
      expect(stepIndicators[1]).toHaveClass('bg-primary');
    });

    it('shows checkmark for completed steps', () => {
      render(
        <WizardLayout
          currentStep={2}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      // Steps 0 and 1 should show checkmarks - look for SVGs within step indicators
      const stepIndicators = document.querySelectorAll('.rounded-full');
      // First two steps should have SVG checkmarks, others should have numbers
      const svgsInSteps = Array.from(stepIndicators).filter(step => step.querySelector('svg'));
      expect(svgsInSteps.length).toBe(2);
    });
  });

  describe('Content Rendering', () => {
    it('renders children content', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div data-testid="child-content">Test Content</div>
        </WizardLayout>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });
  });

  describe('Navigation Footer', () => {
    it('shows back button', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={true}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    });

    it('hides footer on step 0 (firmware selection)', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={true}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      // No navigation buttons on firmware selection step
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('shows start installation button on step 1', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={true}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByRole('button', { name: /start installation/i })).toBeInTheDocument();
    });

    it('back button disabled when canGoBack is false', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    });

    it('next button disabled when canGoNext is false', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.getByRole('button', { name: /start installation/i })).toBeDisabled();
    });
  });

  describe('Footer Visibility', () => {
    it('hides footer during installation (step 2)', () => {
      render(
        <WizardLayout
          currentStep={2}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });

    it('hides footer on complete screen (step 3)', () => {
      render(
        <WizardLayout
          currentStep={3}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });
  });

  describe('Button Interactions', () => {
    it('clicking start installation calls onNext', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={true}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /start installation/i }));

      expect(mockOnNext).toHaveBeenCalledTimes(1);
    });

    it('clicking back calls onBack', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={true}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Content</div>
        </WizardLayout>
      );

      fireEvent.click(screen.getByRole('button', { name: /back/i }));

      expect(mockOnBack).toHaveBeenCalledTimes(1);
    });

  });

  describe('All Steps', () => {
    it('renders correctly at step 0', () => {
      render(
        <WizardLayout
          currentStep={0}
          canGoNext={true}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Step 0 Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Step 0 Content')).toBeInTheDocument();
      // No navigation buttons on step 0 (firmware selection auto-advances)
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('renders correctly at step 1', () => {
      render(
        <WizardLayout
          currentStep={1}
          canGoNext={true}
          canGoBack={true}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Step 1 Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Step 1 Content')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /start installation/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /back/i })).toBeEnabled();
    });

    it('renders correctly at step 2', () => {
      render(
        <WizardLayout
          currentStep={2}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Step 2 Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Step 2 Content')).toBeInTheDocument();
      // No navigation buttons during installation
    });

    it('renders correctly at step 3', () => {
      render(
        <WizardLayout
          currentStep={3}
          canGoNext={false}
          canGoBack={false}
          onNext={mockOnNext}
          onBack={mockOnBack}
          onBackToHome={mockOnBackToHome}
        >
          <div>Step 3 Content</div>
        </WizardLayout>
      );

      expect(screen.getByText('Step 3 Content')).toBeInTheDocument();
      // No navigation buttons on complete screen
    });
  });
});
