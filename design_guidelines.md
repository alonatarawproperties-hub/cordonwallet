# Design Guidelines: EVM Wallet App

## Brand Identity
**Purpose**: Secure, user-friendly crypto wallet for everyday users and power users.

**Aesthetic Direction**: **Refined fintech minimalism** - professional, trustworthy, and restrained. Clean spacing, strong hierarchy, subtle interactions. Avoids the "casino crypto" aesthetic with neon colors and heavy gradients.

**Memorable Element**: Safety-first UI patterns with intelligent transaction previewing and policy enforcement that feels protective, not restrictive.

## Navigation Architecture

**Root Navigation**: Bottom Tab Bar (iOS) / Bottom Navigation (Android)

**Tabs**:
1. **Portfolio** - Asset overview, total balance, network switcher
2. **Activity** - Transaction history and status tracking
3. **Browser** - dApp connection and interaction
4. **Bundles** - Multi-wallet management and batch operations
5. **Settings** - Account, security, policies, preferences

**Modal Screens** (presented from any tab):
- Token Selector
- Send/Receive flows
- Asset Detail
- Firewall Preview Sheet
- Approval management

## Screen-by-Screen Specifications

### Token Selector Screen
**Purpose**: Select token for swap/send with polished, friction-free UX.

**Layout**:
- **Header**: Transparent background, search bar integrated, "Cancel" button (left), no right button
- **Content**: Scrollable list with search-driven sections
- **Safe Area**: Top inset = headerHeight + 16px, Bottom inset = insets.bottom + 16px

**Sections** (in order):
1. **Search Results** (when search active) - prioritize exact matches, then partial matches
2. **Popular Tokens** (default view) - 6-8 verified tokens with high market cap/liquidity
3. **Your Tokens** (if user has balance) - tokens user owns, sorted by USD value descending
4. **All Tokens** - alphabetical, infinite scroll

**REMOVE**: Recently used chips. Recent custom tokens section. Consolidate into "Your Tokens" section only.

**Token Row Specifications**:
- Left: Token logo (40x40px circular), Symbol (Body, Text Primary), Name (Caption, Text Secondary)
- Right: Balance (if owned, Body, Text Primary), USD Value (Caption, Text Secondary)
- Row height: 64px, horizontal padding: 16px
- Verification badge: Small checkmark icon (12px) next to symbol, Success color, only for verified tokens
- Unverified tokens: NO badge (absence communicates unverified status without visual harshness)
- Press state: Surface color background with subtle opacity change (0.8)

**Search Bar**:
- Placeholder: "Search tokens"
- Integrated into header with rounded corners (10px)
- Border color when inactive, Accent border when focused
- Clear button appears when text entered
- Search by symbol, name, or contract address

**Empty States**:
- No search results: Illustration (search-empty.png), "No tokens found", secondary text with "Try searching by contract address"
- No owned tokens: Illustration (empty-wallet.png), "No tokens yet", "Buy or receive tokens to get started"

### Portfolio Screen
**Layout**:
- **Header**: Transparent, network switcher (pill buttons), settings icon (right)
- **Content**: Scrollable, total balance card at top, asset list below
- **Safe Area**: Top inset = headerHeight + 24px, Bottom inset = tabBarHeight + 16px

**Components**:
- Total balance (large heading, collapsible on scroll)
- Network pills (Ethereum, Polygon, etc.)
- Asset cards: Token logo, symbol/name, balance, USD value, 24h change percentage
- Pull-to-refresh for price updates

### Send/Receive Flows
**Layout**: Stack navigation, custom header with progress indicator for multi-step flows
**Safe Area**: Top inset = 16px (header is opaque), Bottom inset = insets.bottom + 16px

**Components**: Large input fields, token selector trigger, network display badge, gas fee preview, confirmation buttons (header or bottom depending on keyboard state)

### Firewall Preview Sheet
**Layout**: Bottom sheet modal, 12px top border radius, drag handle
**Safe Area**: Top inset = 24px, Bottom inset = insets.bottom + 16px

**Components**: Action badge, transaction details (You pay/receive), destination address with explorer link, risk summary with color-coded badge, policy status, dual action buttons (primary + secondary or destructive override)

## Color Palette

### Dark Theme (Default)
- **Background**: `#0B0F14`
- **Surface**: `#111827`
- **Border**: `#1F2937`
- **Text Primary**: `#F9FAFB`
- **Text Secondary**: `#A1A1AA`
- **Accent**: `#3B82F6`
- **Success**: `#22C55E`
- **Warning**: `#F59E0B`
- **Danger**: `#EF4444`

### Light Theme
- **Background**: `#FFFFFF`
- **Surface**: `#F7F8FA`
- **Border**: `#E5E7EB`
- **Text Primary**: `#0B0F14`
- **Text Secondary**: `#6B7280`
- Semantic colors same as dark theme

## Typography
**Font**: SF Pro (iOS), Roboto (Android)

**Type Scale**:
- Heading 1: 24px, Bold
- Heading 2: 20px, Semibold
- Heading 3: 18px, Semibold
- Body: 16px, Regular
- Caption: 13px, Regular
- Small: 12px, Regular

**Hierarchy**: Use weight and color (Primary vs Secondary) for emphasis.

## Design System

### Spacing
8px base unit. Common values: 8px, 12px, 16px, 24px

### Border Radius
- Cards: 12px
- Inputs: 10px
- Pills: 999px
- Buttons: 10px

### Touchable Feedback
- All touchables: Opacity change (0.6) on press
- List rows: Surface background with opacity 0.8
- Floating buttons: Subtle shadow (offset: 0,2 / opacity: 0.10 / radius: 2)

### Icons
- Library: Lucide or system icons
- Size: 20-24px for UI elements
- Stroke: Consistent weight

### Loading States
- Skeleton loaders matching final content shape
- Subtle shimmer animation
- Never show spinners without context

### Transaction States
- Pending: Warning color, animated indicator
- Success: Success color, checkmark
- Failed: Danger color, plain English error with recovery steps

## Assets to Generate

**icon.png** - App icon: Abstract wallet symbol in Accent color on dark gradient background
**WHERE USED**: Device home screen

**splash-icon.png** - Simplified wallet icon: Monochrome version of app icon
**WHERE USED**: App launch screen

**empty-wallet.png** - Empty wallet illustration: Open wallet with minimal line art, dark theme colors
**WHERE USED**: Token selector "Your Tokens" empty state, Portfolio screen when no assets

**search-empty.png** - Search illustration: Magnifying glass with "not found" indicator, subtle and minimal
**WHERE USED**: Token selector search with no results

**token-placeholder.png** - Generic token logo: Circle with "?" symbol, Border color outline
**WHERE USED**: Fallback for tokens without logo images

**eth-logo.png** - Ethereum logo: Official ETH diamond icon
**WHERE USED**: Token selector, portfolio, transaction lists

**usdc-logo.png** - USDC logo: Official Circle USDC icon
**WHERE USED**: Token selector, portfolio, transaction lists

**dai-logo.png** - DAI logo: Official DAI stablecoin icon
**WHERE USED**: Token selector, portfolio, transaction lists

**wbtc-logo.png** - Wrapped Bitcoin logo: Official WBTC icon
**WHERE USED**: Token selector, portfolio, transaction lists

**uni-logo.png** - Uniswap logo: Official UNI token icon
**WHERE USED**: Token selector, portfolio, transaction lists