import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Buffer } from "buffer";
(global as any).Buffer = (global as any).Buffer || Buffer;

import React from "react";
import { StyleSheet, View, LogBox } from "react-native";

LogBox.ignoreLogs([
  "[SwapDebug]",
  "Swap failed",
  "Simulation fail",
]);
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { WalletProvider } from "@/lib/wallet-context";
import { CapAllowanceProvider } from "@/lib/cap-allowance-context";
import { WalletConnectProvider } from "@/lib/walletconnect/context";
import { WalletConnectHandler } from "@/components/WalletConnectHandler";
import { DemoProvider } from "@/lib/demo/context";
import { SecurityOverlayProvider } from "@/context/SecurityOverlayContext";
import { GlobalOverlayHost } from "@/components/GlobalOverlayHost";
import { BrowserStoreProvider } from "@/store/browserStore";
import { ExternalAuthProvider } from "@/context/ExternalAuthContext";
import { DevSettingsProvider } from "@/context/DevSettingsContext";
import { AuthDeepLinkHandler } from "@/components/AuthDeepLinkHandler";
import { ThemedAlertProvider } from "@/components/ThemedAlert";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <DemoProvider>
            <DevSettingsProvider>
              <SafeAreaProvider>
              <CapAllowanceProvider>
                <WalletConnectProvider>
                  <WalletConnectHandler>
                    <SecurityOverlayProvider>
                      <BrowserStoreProvider>
                        <ExternalAuthProvider>
                          <GestureHandlerRootView style={styles.root}>
                            <ThemedAlertProvider>
                              <NavigationContainer>
                                <RootStackNavigator />
                                <AuthDeepLinkHandler />
                              </NavigationContainer>
                              <StatusBar style="auto" />
                              <GlobalOverlayHost />
                            </ThemedAlertProvider>
                          </GestureHandlerRootView>
                        </ExternalAuthProvider>
                      </BrowserStoreProvider>
                    </SecurityOverlayProvider>
                  </WalletConnectHandler>
                </WalletConnectProvider>
              </CapAllowanceProvider>
            </SafeAreaProvider>
              </DevSettingsProvider>
            </DemoProvider>
        </WalletProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
