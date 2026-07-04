---
name: Azure Stream
colors:
  surface: '#faf9fe'
  surface-dim: '#dad9df'
  surface-bright: '#faf9fe'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f8'
  surface-container: '#eeedf3'
  surface-container-high: '#e9e7ed'
  surface-container-highest: '#e3e2e7'
  on-surface: '#1a1b1f'
  on-surface-variant: '#414755'
  inverse-surface: '#2f3034'
  inverse-on-surface: '#f1f0f5'
  outline: '#717786'
  outline-variant: '#c1c6d7'
  surface-tint: '#005bc1'
  primary: '#0058bc'
  on-primary: '#ffffff'
  primary-container: '#0070eb'
  on-primary-container: '#fefcff'
  inverse-primary: '#adc6ff'
  secondary: '#4c4aca'
  on-secondary: '#ffffff'
  secondary-container: '#6664e4'
  on-secondary-container: '#fffbff'
  tertiary: '#9e3d00'
  on-tertiary: '#ffffff'
  tertiary-container: '#c64f00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#e2dfff'
  secondary-fixed-dim: '#c2c1ff'
  on-secondary-fixed: '#0c006a'
  on-secondary-fixed-variant: '#3631b4'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb595'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7c2e00'
  background: '#faf9fe'
  on-background: '#1a1b1f'
  surface-variant: '#e3e2e7'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-xs:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1200px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The brand personality is professional, secure, and efficient. It is designed for users who need a friction-less, trustworthy environment for digital asset management and file distribution. 

The design style is **Modern Minimalism**. It prioritizes clarity and functional hierarchy, utilizing generous whitespace to reduce cognitive load during file browsing. The interface feels "airy" yet structured, employing high-quality typography and a disciplined color application to guide the user's eye toward primary actions like downloads and security prompts.

## Colors

The palette is anchored by a vibrant "Electric Blue" (#007AFF) which denotes action and reliability. 

- **Primary**: Used for the most important actions, such as the main "Download" button and active selection states.
- **Secondary**: A deep violet used sparingly for secondary features like "Share" or "Copy Link" to provide subtle distinction from primary flows.
- **Surface & Background**: A pure white (#FFFFFF) is used for cards and interactive elements, set against a very light gray (#F2F2F7) background to create a clear "layered" effect.
- **Success/System**: Use standard green for "Transfer Complete" and amber for "File Expiration" warnings.

## Typography

The design system utilizes **Hanken Grotesk** across all touchpoints. This typeface offers a contemporary, geometric feel with exceptional legibility for technical data and file names.

- **Headlines**: Use heavy weights (600-700) with slight negative letter-spacing to create a compact, authoritative look for file titles.
- **Body Text**: Standard weights for descriptions and metadata, ensuring a high contrast ratio against the light background.
- **Labels**: Uppercase styling for small metadata (e.g., FILE SIZE, DATE MODIFIED) to distinguish them from standard body copy.

## Layout & Spacing

This design system follows a **Fixed Grid** philosophy for desktop to maintain a centered, focused download experience, while transitioning to a **Fluid Grid** for mobile devices.

- **Desktop**: A 12-column grid with a max-width of 1200px. Content is typically centered in a 6-column or 8-column container for single-file download pages.
- **Spacing Rhythm**: An 8px base unit drives all dimensions. Gutters are fixed at 24px to ensure breathing room between file info cards and sidebars.
- **Breakpoints**: 
    - Mobile: < 600px (4 columns, 20px margins)
    - Tablet: 600px - 1024px (8 columns, 32px margins)
    - Desktop: > 1024px (12 columns)

## Elevation & Depth

Visual hierarchy is achieved through **Ambient Shadows** and **Tonal Layers**. 

- **Level 0 (Background)**: Solid #F2F2F7. No shadow.
- **Level 1 (Cards/Buttons)**: Pure white surface with a soft, diffused shadow: `0px 4px 12px rgba(0, 0, 0, 0.05)`. This creates a subtle "lift" that suggests interactivity without appearing heavy.
- **Level 2 (Hover/Active)**: For interactive cards, the shadow deepens to `0px 8px 24px rgba(0, 0, 0, 0.08)` and the element shifts -2px on the Y-axis.
- **Overlay (Modals/Dropdowns)**: A stronger shadow `0px 12px 32px rgba(0, 0, 0, 0.12)` to clearly separate the utility from the content layer.

## Shapes

The shape language is consistently **Rounded**, using a 0.5rem (8px) base radius. 

- **Cards**: Use 1rem (16px) for the outer container to feel approachable.
- **Inputs & Small Buttons**: Use the base 8px radius.
- **Chips**: Use a full pill-shape (32px+) to distinguish them from actionable buttons.
- **Icon Enclosures**: Soft squares with a 12px radius for brand logos (Dropbox, Google Drive).

## Components

### File Info Cards
The primary container for file metadata. It should feature a large file-type icon on the left, the file name in `title-md`, and a horizontal list of labels (size, format, date) using `label-xs`.

### Cloud Drive Link Buttons
Secondary actions that allow users to save files directly to their own drives. These buttons use a "Ghost" style (transparent background, #007AFF border) and must include the official brand icon (e.g., Google Drive, OneDrive) scaled to 20px.

### Secure Password Input
A focused form component. The input field should have a large, clear focus state (2px solid #007AFF). Use a "eye" icon toggle for visibility and a prominent, full-width `primary` button for submission.

### Progress Bars
Used for active downloads. A thin (4px) track in light gray with a #007AFF fill. Include a percentage label in `label-xs` aligned to the right.

### Chips
Used for file tags or categories. Background should be a very light tint of the primary color (e.g., #007AFF at 10% opacity) with #007AFF text.