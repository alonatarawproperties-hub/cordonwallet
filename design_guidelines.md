# Design Guidelines: EVM Wallet App

## Design Philosophy
**Style**: Minimalist, professional fintech. Clean spacing, strong hierarchy, safety-first tone.

**Avoid**: Neon colors, heavy gradients, meme visuals, "casino" crypto aesthetic, cluttered dashboards.

## Color System

### Light Theme
- Background: `#FFFFFF`
- Surface/Card: `#F7F8FA`
- Border: `#E5E7EB`
- Text Primary: `#0B0F14`
- Text Secondary: `#6B7280`

### Dark Theme
- Background: `#0B0F14`
- Surface/Card: `#111827`
- Border: `#1F2937`
- Text Primary: `#F9FAFB`
- Text Secondary: `#A1A1AA`

### Semantic Colors
- Accent: `#3B82F6`
- Success: `#22C55E`
- Warning: `#F59E0B`
- Danger: `#EF4444`

## Typography

### Font Family
- Mobile: System font stack (SF Pro on iOS, Roboto on Android)
- Web: Inter (with system fallback)

### Scale
- Heading 1: 24px
- Heading 2: 20px
- Heading 3: 18px
- Body: 16px
- Caption: 12-13px

### Hierarchy
Use font weight and color to establish hierarchy. Primary actions use Text Primary; supporting info uses Text Secondary.

## Layout System

### Spacing Grid
8px base unit. Standard paddings: 16px, 24px.

### Border Radius
- Cards/Sheets: 12px
- Inputs: 10px
- Pills/Badges: 999px (fully rounded)

### Elevation
- Use subtle shadows only on modals and bottom sheets
- Otherwise use flat design with borders
- Avoid heavy drop shadows

### Icons
- Use simple line icons (Lucide or similar)
- Consistent stroke width across all icons
- Size: 20-24px for UI elements

## Navigation Architecture

### Mobile (Bottom Tabs)
1. Portfolio
2. Activity
3. Browser (dApps)
4. Bundles
5. Settings

### Web (Left Sidebar)
Same structure as mobile tabs, displayed as vertical navigation.

## Component Specifications

### Buttons
- **Primary**: Accent background, white text
- **Secondary**: Transparent background, Accent border/text
- **Ghost**: Transparent background, no border
- **Destructive**: Danger background, white text

### Input Fields
- Label above input
- Helper text below (Text Secondary)
- Error state (Danger color)
- 10px border radius
- Border on all states

### Cards
- 12px border radius
- Surface background color
- Border in Border color
- 16-24px internal padding

### List Rows
- Title (Text Primary, Body size)
- Subtitle (Text Secondary, Caption size)
- Right value (aligned right)
- Chevron for navigable items

### Badges
- Variants: neutral, success, warning, danger
- 999px border radius
- Small text (Caption size)
- Used for status indicators

### Modals & Bottom Sheets
- Subtle shadow (mobile: bottom sheets preferred)
- 12px top border radius for bottom sheets
- Drag handle indicator on sheets

### Toast Notifications
- Success/Warning/Danger variants
- Auto-dismiss after 3-5 seconds
- Positioned at top or bottom (consistent)

### Loading States
- Skeleton loaders for content loading
- Match the shape of final content
- Subtle shimmer animation

### Empty States
- Centered icon or illustration
- Primary message (Heading 3)
- Supporting text (Body, Text Secondary)
- Optional CTA button

## Critical UX Patterns

### Firewall Preview Sheet
**Title**: "Before you sign"

**Content Structure**:
1. Action type badge (top)
2. "You pay" / "You receive" sections
3. Destination/Spender address with explorer link
4. Highlight "Unlimited approval" in Danger color
5. Risk summary: Low/Medium/High badge + bullet reasons
6. Policy status: Allowed/Blocked with reason

**Buttons**:
- Primary: "Sign" (disabled if blocked)
- Secondary: "Reject"
- If blocked: require "I understand" checkbox + "Override (Danger)" button with confirmation

### Security-First Interactions
- Seed phrase display: Show only once with clear backup warning
- Sensitive actions: Always require confirmation (especially approvals, overrides)
- Error messages: Never show raw RPC errors; use plain English
- Dangerous actions: Use Danger color, explicit confirmation, extra friction

### Transaction States
- Pending: Warning color, animated indicator
- Success: Success color, checkmark
- Failed: Danger color, error explanation with recovery guidance

## Screen Layout Patterns

### Portfolio Screen
- Total balance (large, top)
- Network switcher (pills)
- Asset list (cards or rows)
- Pull-to-refresh

### Asset Detail
- Asset header (icon, name, balance)
- Price chart (optional for MVP)
- Action buttons: Send, Receive, Swap
- Transaction history list

### Send/Receive
- Recipient/Address input (large, clear)
- Amount input (prominent)
- Token selector
- Network display
- Gas fee preview
- Clear error states for validation

### Approvals Dashboard
- Grouped by spender
- Token name, spender address, approved amount
- Highlight unlimited approvals (Danger)
- "Revoke" action (destructive button)
- Cost preview before revoke

### Bundles
- Bundle cards with rollup totals
- "Create Bundle" prominent CTA
- Batch action buttons (guarded by policies)
- Clear visual grouping of wallets in bundle

## Accessibility Requirements
- Minimum touch target: 44x44px
- Color contrast: WCAG AA minimum
- Form inputs: clear labels, error messages
- Critical actions: confirmation dialogs with clear messaging
- Loading states: always provide feedback for async operations