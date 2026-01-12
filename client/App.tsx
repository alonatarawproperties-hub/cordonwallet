import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import React from "react";
import { StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
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

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <DemoProvider>
            <SafeAreaProvider>
              <CapAllowanceProvider>
                <WalletConnectProvider>
                  <WalletConnectHandler>
                    <SecurityOverlayProvider>
                      <View style={styles.root}>
                        <GestureHandlerRootView style={styles.root}>
                          <KeyboardProvider>
                            <NavigationContainer>
                              <RootStackNavigator />
                            </NavigationContainer>
                            <StatusBar style="auto" />
                          </KeyboardProvider>
                        </GestureHandlerRootView>
                        <GlobalOverlayHost />
                      </View>
                    </SecurityOverlayProvider>
                  </WalletConnectHandler>
                </WalletConnectProvider>
              </CapAllowanceProvider>
            </SafeAreaProvider>
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
