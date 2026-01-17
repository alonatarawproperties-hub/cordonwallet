# Design Guidelines: Premium EVM Wallet App

## Brand Identity
**Purpose**: Ultra-premium cryptocurrency wallet for sophisticated crypto users who demand institutional-grade security with luxury-app polish.

**Aesthetic Direction**: **Luxury fintech** - dark, refined, and technically sophisticated. Deep gradients, glass morphism surfaces, subtle glows, and premium materials. Feels like a $1B trading platform meets Apple Wallet's refinement. Every interaction whispers quality.

**Memorable Element**: Glowing gradient accents on high-value elements (balances, primary actions) combined with frosted-glass surfaces that create depth without chaos. The app feels both protective and premium.

## Navigation Architecture
**Root Navigation**: Bottom Tab Bar with frosted glass background

**Tabs**:
1. **Portfolio** - Asset overview with gradient balance card
2. **Swap** - Premium trading interface
3. **Activity** - Transaction history
4. **Settings** - Security, preferences, account

**Modal Screens**: Token Selector, Send/Receive flows, Asset Detail, Transaction Preview

## Screen-by-Screen Specifications

### Portfolio Screen
**Purpose**: Display total balance and asset holdings with premium visual hierarchy.

**Layout**:
- **Header**: Transparent, settings icon (right)
- **Content**: Scrollable, gradient balance card (sticky), asset list below
- **Safe Area**: Top inset = insets.top + 24px, Bottom inset = tabBarHeight + 24px

**Components**:
- **Balance Card**: Frosted glass surface, 16px padding, 16px radius, total balance (Heading 1 with gradient text), 24h change below (Success/Danger color), subtle outer glow matching gradient
- **Network Pills**: Horizontal scroll, glass background, active state has gradient border
- **Asset Rows**: 72px height, token logo (48px), symbol/name (Body/Caption), balance right-aligned (Body), USD value (Caption, Secondary), 24h change pill (Small, colored background). Press state: glass surface brightens (opacity 0.15)
- Pull-to-refresh with premium spinner

**Empty State**: Illustration (empty-wallet.png), "No assets yet", "Buy or receive crypto to start"

### Swap Screen
**Purpose**: Premium trading interface for token swaps.

**Layout**:
- **Header**: Transparent, title centered, settings icon (right)
- **Content**: Scrollable form with floating glass cards
- **Safe Area**: Top inset = insets.top + 24px, Bottom inset = insets.bottom + 24px

**Components**:
- **Token Input Cards**: Frosted glass, 20px radius, 20px padding, "From" and "To" labels (Caption, Secondary), token selector button (glass button with chevron), amount input (Heading 2), USD value below (Caption, Secondary)
- **Swap Arrow**: Circular glass button, 48px, centered between cards, tap to flip tokens, rotate animation on press
- **Rate Display**: Glass pill, exchange rate with refresh icon, subtle pulse animation when updating
- **Fee Breakdown**: Glass surface, 12px radius, gas fee + platform fee rows (Body/Caption), total highlighted
- **Swap Button**: Full width, gradient background (Accent gradient), 56px height, 14px radius, white text (Heading 3), subtle depth shadow, disabled state is desaturated
- All inputs have subtle glow on focus

**States**: Loading shows skeleton with shimmer, error shows inline message with Danger color

### Token Selector Screen
**Purpose**: Select token with premium search and filtering.

**Layout**:
- **Header**: Frosted glass background, integrated search bar, "Cancel" left
- **Content**: Scrollable list with section headers
- **Safe Area**: Top inset = headerHeight + 16px, Bottom inset = insets.bottom + 16px

**Sections**: Popular Tokens, Your Tokens (if balance > 0), All Tokens

**Token Rows**: 64px height, logo (40px circular), symbol/name (Body/Caption), balance + USD value right-aligned, verified badge (12px checkmark, Success color). Press state: glass background (opacity 0.12)

**Search Bar**: Glass background, 10px radius, Accent glow when focused, clear button appears on input

**Empty States**: Illustration (search-empty.png) for no results, (empty-wallet.png) for no owned tokens

### Send/Receive Flows
**Purpose**: Transfer crypto with clear preview and confirmation.

**Layout**: Stack navigation, opaque header with back button, progress dots for multi-step
**Safe Area**: Top inset = 16px, Bottom inset = insets.bottom + 24px

**Components**: Large input fields (glass background), token selector (glass button), address input with paste button, amount input with max button, fee preview (glass card), network badge (glass pill), confirmation screen with gradient preview card showing "You send" details

### Activity Screen
**Purpose**: Transaction history with clear status indicators.

**Layout**:
- **Header**: Transparent, filter icon (right)
- **Content**: Scrollable list grouped by date
- **Safe Area**: Top inset = insets.top + 16px, Bottom inset = tabBarHeight + 16px

**Components**: Date section headers (Caption, Secondary), transaction rows (64px, icon + type, amount, status badge with colored background), pull-to-refresh

### Settings Screen
**Purpose**: Account management and preferences.

**Layout**:
- **Header**: Transparent, title centered
- **Content**: Scrollable grouped list
- **Safe Area**: Top inset = insets.top + 16px, Bottom inset = tabBarHeight + 16px

**Sections**: Account (profile, sign out), Security (passcode, biometrics), Preferences (currency, theme), About (version, terms)

**Profile Row**: Glass surface, 80px height, avatar (56px), name + address preview, edit chevron

## Color Palette

### Dark Theme
- **Background**: `#0A0E13` (deep blue-black)
- **Surface**: `rgba(20, 25, 35, 0.6)` (frosted glass)
- **Border**: `rgba(255, 255, 255, 0.08)`
- **Text Primary**: `#FFFFFF`
- **Text Secondary**: `#8B92A8`
- **Accent Gradient**: `linear-gradient(135deg, #667EEA 0%, #4F46E5 100%)`
- **Success**: `#10B981`
- **Warning**: `#F59E0B`
- **Danger**: `#EF4444`
- **Glow**: `rgba(102, 126, 234, 0.25)` (Accent color at 25% opacity)

## Typography
**Font**: SF Pro Display (iOS), Google Fonts - Inter (Android)

**Type Scale**:
- Heading 1: 32px, Bold (balances, key numbers)
- Heading 2: 24px, Semibold (input amounts)
- Heading 3: 18px, Semibold (button labels)
- Body: 16px, Medium (primary text)
- Caption: 14px, Regular (secondary labels)
- Small: 12px, Medium (badges, footnotes)

**Gradient Text**: Apply Accent Gradient to large balance displays for premium feel

## Design System

### Glass Morphism
- **Surface**: Background color with 60% opacity, 20px blur backdrop
- **Border**: 1px solid rgba(255,255,255,0.08)
- **Shadow**: Multiple layers - outer glow (0,8px,24px,rgba(0,0,0,0.4)) + inner highlight (inset 0,1px,0,rgba(255,255,255,0.06))

### Spacing
12px base unit. Common: 12px, 16px, 20px, 24px, 32px

### Border Radius
- Cards: 16-20px
- Inputs: 12px
- Pills: 999px
- Buttons: 14px

### Touchable Feedback
- Glass surfaces: Brightness increase (opacity +0.15) on press
- Gradient buttons: Scale down to 0.97 with subtle glow expansion
- All transitions: 150ms ease-out

### Glows and Depth
- **Premium Elements**: Outer glow using Glow color, 8px spread, 16px blur
- **Floating Buttons**: shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.15, shadowRadius: 8, subtle gradient overlay
- **Focus States**: Accent Gradient border (2px) with expanded glow

### Icons
- Library: Lucide (consistent 2px stroke)
- Size: 24px default, 20px compact, 32px featured
- Color: Text Primary or gradient for premium actions

### Animations
- **Micro-interactions**: Scale (0.97), rotation (180deg for flip), opacity transitions
- **Loading States**: Shimmer gradient sweep, skeleton with glass background
- **Success**: Checkmark scale-in with bounce, subtle confetti burst
- **Price Updates**: Flash Success/Danger color briefly, fade to normal

## Assets to Generate

**icon.png** - App icon: Abstract shield-wallet symbol with gradient (Accent Gradient), minimal geometric style
**WHERE USED**: Device home screen

**splash-icon.png** - Simplified icon: Monochrome shield-wallet, refined line art
**WHERE USED**: App launch screen

**empty-wallet.png** - Premium empty state: Minimal wallet outline with subtle gradient stroke, dark background
**WHERE USED**: Portfolio and Token Selector empty states

**search-empty.png** - Search illustration: Magnifying glass with gradient accent, floating on dark background
**WHERE USED**: Token Selector no results state

**token-placeholder.png** - Generic token: Gradient circle with "?" symbol, glass border
**WHERE USED**: Fallback for tokens without logos

**eth-logo.png**, **usdc-logo.png**, **dai-logo.png**, **wbtc-logo.png**, **uni-logo.png** - Official token logos
**WHERE USED**: Token Selector, Portfolio, Swap interface, Activity list