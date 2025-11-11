# Design Guide - BlueBuzzah Updater

## Design Philosophy

The BlueBuzzah Updater follows a modern, production-ready design philosophy centered on:

1. **Clarity**: Every step in the wizard should be immediately understandable
2. **Confidence**: Users should feel secure throughout the firmware update process
3. **Brand Identity**: Consistent use of BlueBuzzah colors and visual language
4. **Professional Polish**: Smooth animations, subtle glows, and attention to detail
5. **Dark-First**: Optimized for extended use with reduced eye strain

## Visual Identity

### Brand Colors

#### Primary Colors

- **Highlight Blue**: `#35B6F2` (HSL: 198° 86% 58%)

  - Purpose: Primary buttons, accents, progress bars, badges, focus rings
  - Effect: High-contrast highlights that draw attention to interactive elements
  - Psychology: Technology, reliability, innovation

- **Dark Navy**: `#05212D` (HSL: 199° 74% 10%)
  - Purpose: Card backgrounds, secondary surfaces, input fields
  - Effect: Rich depth and layering while maintaining readability
  - Psychology: Depth, sophistication, premium quality

#### Base Colors

- **Background**: `#0a0a0a` (Pure dark)

  - Main application background

- **Foreground**: `#fafafa` (Off-white)
  - Primary text color for maximum readability

### Color Application Strategy

#### Interactive Elements

**Primary Actions** (buttons, links, CTAs)

- Background: `#35B6F2` with subtle glow effect
- Text: `#0a0a0a` (dark on bright for contrast)
- Hover: Slight brightness increase (90% opacity)
- Focus: Blue ring with 2px offset
- Rationale: Blue stands out against dark backgrounds, immediately indicating clickable elements

#### Cards & Surfaces

**Cards**

- Background: Gradient from `#05212D` to slightly lighter navy
- Border: Subtle lighter navy (`#1a3340`)
- Hover: Blue shadow glow (`rgba(53, 182, 242, 0.2)`)
- Rationale: Creates depth hierarchy without harsh borders

#### Status Indicators

**Success States**

- Icon: `#35B6F2` (blue instead of traditional green)
- Glow: Blue with 20% opacity
- Message: Light text on dark navy
- Rationale: Brand consistency—success uses blue to reinforce brand identity

**Progress Bars**

- Fill: `#35B6F2` with blue glow effect
- Background: Dark navy with 20% opacity
- Animation: Smooth transitions with 200ms duration
- Rationale: Visual feedback is critical during firmware updates

**Badges**

- Primary: Blue background with dark text
- Secondary: Dark navy with light text
- Glow: Subtle blue shadow on hover
- Use cases: Version numbers, device roles (PRIMARY/SECONDARY)

### Text Hierarchy

- **Primary**: `#fafafa` (98% lightness) — Headers, important labels
- **Secondary**: `#a3a3a3` (64% lightness) — Descriptions, metadata
- **Muted**: Dark navy with reduced opacity — Helper text, timestamps

### CSS Variables

```css
:root {
  /* Base */
  --background: 0 0% 4%; /* #0a0a0a */
  --foreground: 0 0% 98%; /* #fafafa */

  /* Cards */
  --card: 199 74% 10%; /* #05212D */
  --card-foreground: 0 0% 98%;

  /* Primary - Bright Blue */
  --primary: 198 86% 58%; /* #35B6F2 */
  --primary-foreground: 0 0% 4%; /* #0a0a0a */

  /* Secondary - Dark Navy */
  --secondary: 199 74% 10%; /* #05212D */
  --secondary-foreground: 0 0% 98%;

  /* Accent */
  --accent: 198 86% 58%; /* #35B6F2 */
  --accent-foreground: 0 0% 4%;

  /* Borders & Inputs */
  --border: 199 74% 15%; /* Lighter navy */
  --input: 199 74% 12%; /* Dark navy */
  --ring: 198 86% 58%; /* #35B6F2 */
}
```

## Typography

### Font Stack

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

- Rationale: Native system fonts ensure optimal rendering and familiarity across platforms

### Size Scale

- **Headings**:
  - H1: 2rem (32px) — Page titles
  - H2: 1.5rem (24px) — Step titles
  - H3: 1.25rem (20px) — Card titles
- **Body**: 1rem (16px) — Primary text
- **Small**: 0.875rem (14px) — Helper text, metadata
- **Tiny**: 0.75rem (12px) — Badges, timestamps

### Weight Scale

- **Bold** (700): Headers, emphasis
- **Semibold** (600): Subheaders, important labels
- **Medium** (500): Body text, buttons
- **Regular** (400): Helper text

### Line Height

- Headers: 1.2 (tight, impactful)
- Body: 1.5 (comfortable reading)
- Small text: 1.4 (compact but readable)

## Component Design Patterns

### Wizard Layout

**Step Indicator**

- Visual: Horizontal circles connected by lines
- Active step: Blue background with blue glow
- Completed step: Blue checkmark
- Inactive step: Muted gray
- Purpose: Provides immediate progress context

**Navigation**

- Back button: Secondary style (navy background)
- Next/Continue button: Primary style (blue background)
- Cancel: Ghost/outline style
- Position: Bottom of wizard, right-aligned
- Rationale: Follows standard wizard UX patterns

### Buttons

**Hierarchy**

1. **Primary**: Blue background, dark text — Main actions ("Next Step", "Install")
2. **Secondary**: Navy background, light text — Alternative actions ("Go Back")
3. **Ghost**: Transparent with hover state — Tertiary actions ("Show Logs")
4. **Destructive**: Red tones (rare use) — Dangerous actions

**States**

- Default: Solid background
- Hover: 90% opacity + scale(1.02) transform
- Active: 95% opacity + scale(0.98) transform
- Disabled: 50% opacity + no pointer events
- Focus: Blue ring with 2px offset

### Cards

**Structure**

```tsx
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
    <CardDescription>Subtitle/metadata</CardDescription>
  </CardHeader>
  <CardContent>{content}</CardContent>
</Card>
```

**Visual Treatment**

- Background: Gradient from dark navy (`#05212D`)
- Border radius: 0.5rem (8px)
- Padding: 1.5rem (24px)
- Hover: Blue glow shadow

**Use Cases**

- Device cards: Display connected devices with role badges
- Firmware cards: Show release information with version badges
- Progress cards: Real-time installation status
- Success summary: Post-installation instructions

### Progress Indicators

**Linear Progress Bar**

- Height: 0.5rem (8px) for subtle, 0.75rem (12px) for prominent
- Fill: Blue with glow effect
- Background: Navy with 20% opacity
- Animation: Smooth width transition (200ms ease-in-out)
- Label: Percentage displayed alongside (e.g., "75%")

**Spinner (Loading State)**

- Icon: `Loader2` from lucide-react
- Animation: Infinite rotation
- Color: Blue
- Size: 1.25rem (20px) inline, 2.5rem (40px) standalone

### Toasts & Notifications

**Structure**

- Position: Bottom-right corner
- Max width: 20rem (320px)
- Duration: 4000ms (4 seconds)
- Animation: Slide-in from right, fade out

**Variants**

- Success: Blue icon + title
- Error: Red icon + title + detailed message
- Info: Blue icon + title
- Rationale: Uses Radix UI toast primitives for accessibility

### Badges

**Variants**

- `default`: Blue background — "Latest", version numbers
- `secondary`: Navy background — "PRIMARY", "SECONDARY"
- `outline`: Transparent with blue border — Optional states

**Sizing**

- Default: 0.75rem (12px) text, compact padding
- Purpose: Concise labels that don't dominate visual hierarchy

### Select Dropdowns

**Appearance**

- Background: Navy (`#05212D`)
- Border: Lighter navy with blue on focus
- Dropdown: Card-styled menu with hover states
- Icons: Chevron indicators

**States**

- Closed: Shows selected value
- Open: Dropdown appears below with options
- Hover: Option highlights with subtle blue glow
- Selected: Blue checkmark indicator

## Visual Effects

### Shadows & Glows

**Blue Glow (Standard)**

```css
box-shadow: 0 0 15px rgba(53, 182, 242, 0.2);
```

- Use: Active elements, success states, primary buttons on hover

**Card Hover Glow**

```css
box-shadow: 0 10px 30px -5px rgba(53, 182, 242, 0.2);
```

- Use: Cards on hover to indicate interactivity

**Progress Bar Glow**

```css
box-shadow: 0 0 10px rgba(53, 182, 242, 0.3);
```

- Use: Progress bars during active installation

**Pulse Animation**

```css
@keyframes pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 0.4;
  }
}
```

- Use: Success screen background glow

### Gradients

**Card Backgrounds**

- Direction: Top to bottom
- Start: `#05212D`
- End: Slightly lighter navy (5% increase in lightness)
- Purpose: Subtle depth without overwhelming content

### Transitions

**Standard Timing**

```css
transition: all 200ms ease-in-out;
```

- Use: All interactive elements (buttons, links, cards, inputs)

**Transform Interactions**

- Hover: `scale(1.02)` — Subtle lift effect
- Active: `scale(0.98)` — Pressed effect
- Rationale: Provides tactile feedback without being distracting

**Color Transitions**

- Smooth opacity changes for hover states
- Focus ring appears instantly (no transition) for accessibility

### Animations

**Fade In**

```css
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- Use: Component mounting, wizard step transitions

**Slide In**

```css
@keyframes slideIn {
  from {
    transform: translateX(20px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
```

- Use: Toast notifications, success screen elements

**Spin (Loading)**

```css
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

- Use: Loading spinners during async operations

## Layout & Spacing

### Container System

**Wizard Container**

- Max width: 56rem (896px)
- Centered horizontally with `mx-auto`
- Padding: 1.5rem (24px) on mobile, 2rem (32px) on desktop
- Rationale: Optimal reading width, prevents eye strain

**Grid System**

- Device cards: 1 column mobile, 2 columns desktop
- Gap: 1rem (16px) between cards
- Uses CSS Grid with responsive breakpoints

### Spacing Scale (Tailwind)

- `space-y-2`: 0.5rem (8px) — Tight groupings
- `space-y-4`: 1rem (16px) — Related elements
- `space-y-6`: 1.5rem (24px) — Section spacing (most common)
- `space-y-8`: 2rem (32px) — Major sections
- `space-y-12`: 3rem (48px) — Page sections

### Padding Conventions

- Card padding: `p-6` (1.5rem/24px)
- Button padding: `px-4 py-2` (16px/8px)
- Input padding: `px-3 py-2` (12px/8px)

### Border Radius

- Buttons: `rounded-md` (0.375rem/6px)
- Cards: `rounded-lg` (0.5rem/8px)
- Badges: `rounded-full` (fully rounded)
- Inputs: `rounded-md` (0.375rem/6px)

## Iconography

### Icon Library

**Lucide React** — Consistent, modern, open-source icon set

### Common Icons

- `HardDrive`: Device representation
- `Download`: Firmware download state
- `Trash2`: Wiping/cleanup operations
- `Copy`: File copying operations
- `Settings`: Configuration steps
- `CheckCircle2`: Success states
- `XCircle`: Error states
- `Loader2`: Loading/processing states
- `ChevronDown`: Dropdown indicators
- `AlertCircle`: Warnings/info messages

### Icon Sizing

- Inline (with text): `h-4 w-4` (1rem/16px)
- Standalone (buttons): `h-5 w-5` (1.25rem/20px)
- Large (headers): `h-6 w-6` (1.5rem/24px)
- Hero (success screen): `h-20 w-20` (5rem/80px)

### Icon Colors

- Primary actions: Blue (`text-primary`)
- Success: Blue (`text-primary`)
- Errors: Red (`text-destructive`)
- Neutral: Foreground (`text-foreground`)
- Muted: Secondary (`text-muted-foreground`)

## Wizard Flow UX

### Step 1: Firmware Selection

**Goal**: Choose firmware version to install

**Layout**

- Title: "Select Firmware Version"
- Description: Explain GitHub release integration
- Content: Scrollable list of firmware releases
- Each release shows:
  - Version number (badge)
  - Release date
  - Release notes (truncated, expandable)
  - Download button/selection

**Interactions**

- Click release card to select
- Selected card: Blue border + glow
- "Next Step" button: Disabled until selection made

### Step 2: Device Selection

**Goal**: Choose which connected devices to update

**Layout**

- Title: "Select Devices"
- Subtitle: Auto-detection status
- Content: Grid of detected devices
- Each device shows:
  - Device name/label
  - Mount path
  - CircuitPython version
  - Role dropdown (PRIMARY/SECONDARY)
  - Checkbox for selection

**Interactions**

- Auto-detect devices on mount
- Select/deselect devices via checkbox
- Assign role via dropdown
- "Next Step" button: Disabled until ≥1 device selected

**Error States**

- No devices detected: Show helpful message with troubleshooting link
- Mount issues: Display specific error with resolution steps

### Step 3: Installation Progress

**Goal**: Provide real-time feedback during firmware installation

**Layout**

- Title: Dynamic based on stage (Downloading/Installing/Complete)
- Overall progress bar (0-100%)
- Download progress card (during download)
- Per-device progress cards (during installation)
- Installation log (collapsible)

**Progress Stages**

1. **Downloading** (0-20%): Fetch firmware from GitHub
2. **Installing** (20-100%): Update each device sequentially
   - **Wiping**: Clear old firmware
   - **Copying**: Transfer new files (shows current file)
   - **Configuring**: Write role-specific config.py
   - **Complete**: Per-device completion

**Real-time Updates**

- Progress bars update smoothly
- Current file being copied displays below progress
- Logs append with timestamp
- Stage icons change (Download → Trash → Copy → Settings → Check)

### Step 4: Success Screen

**Goal**: Confirm successful installation and provide next steps

**Layout**

- Large blue checkmark with glow effect
- Title: "Installation Complete!"
- Success message
- Summary card showing:
  - Firmware version installed
  - Number of devices updated
  - Device roles
- Next steps list:
  1. Unplug devices safely
  2. Test device functionality
  3. Verify config.py settings
- "Finish" button returns to start

**Visual Treatment**

- Blue checkmark with pulse animation
- Blue glow background effect
- Numbered steps with blue indicators

## Accessibility

### Color Contrast

- All text meets WCAG AA standards (minimum 4.5:1 contrast ratio)
- Blue on dark: 7.2:1 contrast
- White on dark navy: 12.8:1 contrast
- Primary button text (dark on blue): 7.5:1 contrast

### Color Blindness Support

- Blue/dark contrast works for deuteranopia and protanopia
- Interactive states use multiple indicators:
  - Color (blue vs. gray)
  - Shadow/glow effects
  - Text labels
  - Icons
- Never rely on color alone

### Keyboard Navigation

- All interactive elements accessible via Tab
- Focus ring: Blue (`--ring`) with 2px offset
- Focus order follows logical flow (top to bottom, left to right)
- Escape key closes dropdowns and dialogs

### Screen Readers

- Semantic HTML (`<button>`, `<nav>`, `<main>`, etc.)
- ARIA labels on icon-only buttons
- Progress bars announce percentage updates
- Toast notifications use ARIA live regions
- Error messages associated with form inputs via `aria-describedby`

### Motion & Animation

- All animations respect `prefers-reduced-motion` media query
- Loading states provide textual alternatives
- Progress indicators use deterministic bars (not infinite spinners when possible)

## Design Constraints & Rationale

### Technology Constraints

**Tauri Framework**

- Native window chrome (no custom titlebar)
- Rationale: Better OS integration, familiar window controls

**System Fonts Only**

- No web fonts to minimize bundle size
- Rationale: Faster load times, native feel, smaller app size

**Dark Theme Only**

- No light mode toggle
- Rationale: Firmware updates often happen in focused, extended sessions; dark theme reduces eye strain

### UX Constraints

**Linear Wizard Flow**

- No skipping steps
- Back button always available (except during installation)
- Rationale: Firmware updates require careful, sequential actions

**No Manual File Selection**

- Firmware always from GitHub releases
- Devices always auto-detected
- Rationale: Reduces user error, ensures only compatible firmware installed

**Single Firmware Version at a Time**

- Cannot install different versions on different devices in same session
- Rationale: Simplifies UX, prevents version mismatch confusion

### Visual Constraints

**Minimal Color Palette**

- Only blue, navy, and neutrals
- No additional brand colors
- Rationale: Creates focused, distraction-free interface

**No Illustrations or Complex Graphics**

- Icon-based visual language only
- Rationale: Professional appearance, smaller bundle size

**Fixed Maximum Width**

- Wizard container capped at 896px
- Rationale: Prevents overly wide layouts on large monitors

## Component Library

### Tech Stack

- **UI Components**: shadcn/ui (dark theme variants)
- **Icons**: Lucide React
- **Styling**: Tailwind CSS
- **Primitives**: Radix UI (accessible base components)

### Custom Components

**WizardLayout**

- Provides step indicator and navigation
- Manages wizard state transitions
- Enforces linear flow

**InstallationProgress**

- Handles async firmware operations
- Manages per-device progress state
- Provides real-time logging

**SuccessScreen**

- Displays success state with blue theme (not green)
- Shows installation summary
- Provides clear next steps

### Styling Philosophy

**Utility-First with Tailwind**

- Compose styles directly in JSX with utility classes
- Custom utilities defined in `index.css` for repeated patterns
- No separate CSS modules

**Component Variants**

- Use `class-variance-authority` for variant-based styling
- Defined in component files (e.g., Button, Badge)
- Ensures consistency across similar components

**Responsive Design**

- Mobile-first approach
- Breakpoints: sm (640px), md (768px), lg (1024px)
- Grid layouts adjust from 1 column to 2 columns

## Code Style

### Component Structure

```tsx
// 1. Imports
import { useState } from "react";
import { Button } from "@/components/ui/button";

// 2. Types/Interfaces
interface Props {
  // ...
}

// 3. Component definition
export function Component({ prop }: Props) {
  // 4. State
  const [state, setState] = useState();

  // 5. Handlers
  const handleClick = () => {
    // ...
  };

  // 6. Render
  return <div>{/* Content */}</div>;
}
```

### Class Names

```tsx
// Use cn() helper from lib/utils.ts for conditional classes
<Button className={cn(
  "base-classes",
  isActive && "active-classes",
  className // Allow prop override
)}>
```

### Avoid Inline Styles

- Use Tailwind utilities instead
- Exception: Dynamic values (e.g., `style={{ width: `${progress}%` }}`)

## File Organization

```
src/
├── components/
│   ├── ui/              # shadcn/ui primitives
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── progress.tsx
│   │   └── ...
│   ├── wizard/          # Wizard step components
│   │   ├── FirmwareSelection.tsx
│   │   ├── DeviceSelection.tsx
│   │   ├── InstallationProgress.tsx
│   │   └── SuccessScreen.tsx
│   └── layout/          # Layout components
│       └── WizardLayout.tsx
├── services/            # Business logic
│   ├── FirmwareService.ts
│   └── DeviceService.ts
├── stores/              # Zustand state management
│   └── wizardStore.ts
├── types/               # TypeScript definitions
│   └── index.ts
├── lib/                 # Utilities
│   ├── utils.ts         # cn() helper
│   └── config.ts        # Config templates
└── index.css            # Global styles + Tailwind
```

## Design System Checklist

When creating new components or features, ensure:

- [ ] Uses brand colors (#35B6F2 for primary, #05212D for secondary)
- [ ] Text meets WCAG AA contrast standards
- [ ] Includes hover/focus/active states
- [ ] Blue focus ring with 2px offset
- [ ] Smooth transitions (200ms ease-in-out)
- [ ] Keyboard accessible (Tab navigation)
- [ ] Screen reader friendly (semantic HTML, ARIA labels)
- [ ] Icons from Lucide React
- [ ] Spacing follows Tailwind scale (4, 6, 8, 12)
- [ ] Border radius appropriate for element type
- [ ] Respects `prefers-reduced-motion`
- [ ] Mobile responsive (test at 640px width)
- [ ] Error states handled gracefully
- [ ] Loading states use Loader2 spinner or Progress component

## Future Considerations

### Potential Enhancements

- **Light theme**: If user feedback indicates demand
- **Custom firmware sources**: Beyond GitHub releases
- **Batch operations**: Different firmware versions per device
- **History/logging**: Track past installations

### Design Scalability

The current design system is built to accommodate:

- Additional wizard steps (insert between existing steps)
- New device types (extend device detection)
- More complex firmware options (multiple files, dependencies)
- Settings/preferences screen (match card-based layout)

### Brand Evolution

If BlueBuzzah brand colors change:

1. Update CSS variables in `src/index.css`
2. Verify contrast ratios with new colors
3. Update this guide with new hex values
4. Test all interactive states
