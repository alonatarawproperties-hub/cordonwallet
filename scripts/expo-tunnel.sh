#!/bin/bash
# Expo Tunnel Mode for Expo Go testing on physical devices

echo "Starting Expo in tunnel mode..."
echo "Wait for the QR code, then scan with Expo Go"
echo ""

npx expo start --tunnel --clear
