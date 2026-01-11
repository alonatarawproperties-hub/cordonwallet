import React, { useState, useCallback } from "react";
import { StyleSheet, Pressable } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { useTheme } from "@/hooks/useTheme";

import SplashScreen from "@/screens/SplashScreen";
import WelcomeScreen from "@/screens/WelcomeScreen";
import CreateWalletScreen from "@/screens/CreateWalletScreen";
import ImportWalletScreen from "@/screens/ImportWalletScreen";
import SetupPinScreen from "@/screens/SetupPinScreen";
import BackupWarningScreen from "@/screens/BackupWarningScreen";
import SeedPhraseScreen from "@/screens/SeedPhraseScreen";
import UnlockScreen from "@/screens/UnlockScreen";
import SendScreen from "@/screens/SendScreen";
import ReceiveScreen from "@/screens/ReceiveScreen";
import AssetDetailScreen from "@/screens/AssetDetailScreen";
import TransactionDetailScreen from "@/screens/TransactionDetailScreen";
import WalletManagerScreen from "@/screens/WalletManagerScreen";
import ApprovalsScreen from "@/screens/ApprovalsScreen";
import PolicySettingsScreen from "@/screens/PolicySettingsScreen";
import CreateBundleScreen from "@/screens/CreateBundleScreen";
import ManageCryptoScreen from "@/screens/ManageCryptoScreen";
import ImportTokenScreen from "@/screens/ImportTokenScreen";
import SendDetailsScreen from "@/screens/SendDetailsScreen";
import ScanQRScreen from "@/screens/ScanQRScreen";
import WalletConnectScreen from "@/screens/WalletConnectScreen";
import WCScannerScreen from "@/screens/WCScannerScreen";
import DemoFlowScreen from "@/screens/DemoFlowScreen";
import type { BootResult, InitialRoute } from "@/lib/bootstrap";

export type TransactionDetailParams = {
  hash: string;
  chainId: number;
  activityType: "send" | "receive" | "swap";
  tokenSymbol: string;
  amount: string;
  to: string;
  from?: string;
  status: "pending" | "confirmed" | "failed";
  createdAt: number;
  explorerUrl: string;
  gasUsed?: string;
  gasPrice?: string;
};

export type RootStackParamList = {
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  SetupPin: { mnemonic: string; walletName: string; isImport?: boolean; walletType?: "multi-chain" | "solana-only" };
  BackupWarning: { seedPhrase: string[]; walletId: string };
  SeedPhrase: { seedPhrase: string[]; walletId: string };
  Unlock: undefined;
  Main: undefined;
  Send: { tokenSymbol?: string } | undefined;
  Receive: { walletAddress: string; solanaAddress?: string };
  AssetDetail: {
    tokenSymbol: string;
    tokenName: string;
    balance: string;
    chainId: number;
    chainName: string;
    isNative: boolean;
    address?: string;
    priceUsd?: number;
    valueUsd?: number;
    priceChange24h?: number;
    chainType?: "evm" | "solana";
    logoUrl?: string;
  };
  TransactionDetail: TransactionDetailParams;
  WalletManager: undefined;
  Approvals: undefined;
  PolicySettings: undefined;
  CreateBundle: undefined;
  ManageCrypto: undefined;
  ImportToken: undefined;
  SendDetails: {
    tokenSymbol: string;
    tokenAddress?: string;
    chainType: "evm" | "solana";
    chainId: number;
    decimals: number;
    balance: string;
    priceUsd?: number;
    isNative: boolean;
    scannedAddress?: string;
    logoUrl?: string;
  };
  ScanQR: undefined;
  WalletConnect: undefined;
  WCScanner: undefined;
  DemoFlow: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();
  const { theme } = useTheme();
  const [isBooting, setIsBooting] = useState(true);
  const [initialRoute, setInitialRoute] = useState<InitialRoute>("Welcome");
  const [bootResult, setBootResult] = useState<BootResult | null>(null);

  const handleBootComplete = useCallback((result: BootResult) => {
    console.log("[RootStack] Boot complete:", {
      route: result.initialRoute,
      sessions: result.restoredSessionsCount,
      degraded: result.degraded,
      timings: result.timings,
    });
    setBootResult(result);
    setInitialRoute(result.initialRoute);
    setIsBooting(false);
  }, []);

  if (isBooting) {
    return <SplashScreen onBootComplete={handleBootComplete} />;
  }

  return (
    <Stack.Navigator screenOptions={screenOptions} initialRouteName={initialRoute}>
      <Stack.Screen
        name="Welcome"
        component={WelcomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateWallet"
        component={CreateWalletScreen}
        options={{ headerTitle: "Create Wallet" }}
      />
      <Stack.Screen
        name="ImportWallet"
        component={ImportWalletScreen}
        options={{ headerTitle: "Import Wallet" }}
      />
      <Stack.Screen
        name="SetupPin"
        component={SetupPinScreen}
        options={{ headerTitle: "Set PIN", headerBackVisible: false }}
      />
      <Stack.Screen
        name="BackupWarning"
        component={BackupWarningScreen}
        options={{ headerTitle: "Backup Warning", headerBackVisible: false }}
      />
      <Stack.Screen
        name="SeedPhrase"
        component={SeedPhraseScreen}
        options={{ headerTitle: "Seed Phrase", headerBackVisible: false }}
      />
      <Stack.Screen
        name="Unlock"
        component={UnlockScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Main"
        component={MainTabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Send"
        component={SendScreen}
        options={{ headerTitle: "Send", presentation: "modal" }}
      />
      <Stack.Screen
        name="Receive"
        component={ReceiveScreen}
        options={{ headerTitle: "Receive", presentation: "modal" }}
      />
      <Stack.Screen
        name="AssetDetail"
        component={AssetDetailScreen}
        options={{ headerTitle: "Asset" }}
      />
      <Stack.Screen
        name="TransactionDetail"
        component={TransactionDetailScreen}
        options={{ headerTitle: "Transaction" }}
      />
      <Stack.Screen
        name="WalletManager"
        component={WalletManagerScreen}
        options={{ headerTitle: "Wallets", presentation: "modal" }}
      />
      <Stack.Screen
        name="Approvals"
        component={ApprovalsScreen}
        options={{ headerTitle: "Security", presentation: "modal" }}
      />
      <Stack.Screen
        name="PolicySettings"
        component={PolicySettingsScreen}
        options={{ headerTitle: "Policy Settings", presentation: "modal" }}
      />
      <Stack.Screen
        name="CreateBundle"
        component={CreateBundleScreen}
        options={{ headerTitle: "Create Bundle", presentation: "modal" }}
      />
      <Stack.Screen
        name="ManageCrypto"
        component={ManageCryptoScreen}
        options={{ 
          headerTitle: "Manage crypto",
          headerRight: () => (
            <Pressable onPress={() => {}} style={{ padding: 8 }}>
              <Feather name="plus" size={22} color={theme.accent} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="ImportToken"
        component={ImportTokenScreen}
        options={{ headerTitle: "Import crypto" }}
      />
      <Stack.Screen
        name="SendDetails"
        component={SendDetailsScreen}
        options={{ headerTitle: "Send" }}
      />
      <Stack.Screen
        name="ScanQR"
        component={ScanQRScreen}
        options={{ headerShown: false, presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="WalletConnect"
        component={WalletConnectScreen}
        options={{ headerTitle: "WalletConnect" }}
      />
      <Stack.Screen
        name="WCScanner"
        component={WCScannerScreen}
        options={{ headerShown: false, presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="DemoFlow"
        component={DemoFlowScreen}
        options={{ headerTitle: "Demo Mode", presentation: "modal" }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
