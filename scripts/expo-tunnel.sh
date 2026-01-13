#!/bin/bash
# Expo Tunnel Mode for Expo Go testing on physical devices
# This creates a public ngrok tunnel that bypasses Replit's firewall

# Raw domain without port - getApiUrl() adds :5000 for dev environments
export EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN}"

echo "Starting Expo in tunnel mode..."
echo "Wait for the QR code, then scan with Expo Go"
echo ""

npx expo start --tunnel --clear
