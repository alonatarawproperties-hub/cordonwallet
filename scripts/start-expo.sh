#!/bin/bash
# Expo Start Script for Replit - Tunnel mode with non-interactive auth

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           CORDON - Expo Development Server                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Mode: TUNNEL (bypasses firewall/NAT)                        ║"
echo "║  Auth: Non-interactive (CI mode)                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Set environment variables for Replit
export EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN}:5000"
export CI=1

# Check if EXPO_TOKEN is set
if [ -n "$EXPO_TOKEN" ]; then
    echo "[✓] EXPO_TOKEN detected - authenticated tunnel mode"
else
    echo "[i] Using anonymous tunnel mode"
    echo "    For best reliability, add EXPO_TOKEN secret"
    echo "    Get token: https://expo.dev/settings/access-tokens"
fi
echo ""
echo "Starting Metro bundler with tunnel..."
echo ""

# Start Expo with tunnel mode - CI=1 enables non-interactive
npx expo start --tunnel --clear
