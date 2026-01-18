#!/bin/bash
# Expo Start Script for Replit - Tunnel mode for Expo Go

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           CORDON - Expo Development Server                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Scan the QR code below with Expo Go to test on your phone   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Set environment variables for Replit
# Raw domain without port - getApiUrl() adds :5000 for dev environments
export EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN}"

# EXPO_TOKEN is required for tunnel mode authentication
# Get one from: https://expo.dev/accounts/[your-username]/settings/access-tokens
if [ -z "$EXPO_TOKEN" ]; then
  echo "WARNING: EXPO_TOKEN not set. Tunnel may fail without authentication."
  echo "Get a token from: https://expo.dev/accounts/[your-username]/settings/access-tokens"
fi

# File to store tunnel URL for the backend to read
TUNNEL_URL_FILE="/tmp/expo-tunnel-url.txt"

echo "Starting Metro bundler with tunnel..."
echo ""

# Kill any stale Metro processes on port 8081
fuser -k 8081/tcp 2>/dev/null || true
sleep 1

# Start a background process to monitor for the tunnel URL
(
  sleep 10  # Wait for tunnel to establish
  for i in {1..30}; do
    # Check Expo's dev server logs for tunnel URL
    TUNNEL_HOST=$(curl -s http://localhost:8081/ 2>/dev/null | grep -o 'exp://[^"]*\.exp\.direct' | head -1)
    if [[ -n "$TUNNEL_HOST" ]]; then
      echo "$TUNNEL_HOST" > "$TUNNEL_URL_FILE"
      echo "[Tunnel URL captured: $TUNNEL_HOST]"
      break
    fi
    sleep 2
  done
) &

# Start Expo with tunnel mode
npx expo start --tunnel
