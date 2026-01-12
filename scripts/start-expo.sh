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
export EXPO_PUBLIC_DOMAIN="${REPLIT_DEV_DOMAIN}:5000"

echo "Starting Metro bundler with tunnel..."
echo ""

# Start Expo with tunnel mode - shows QR code for scanning
npx expo start --tunnel
