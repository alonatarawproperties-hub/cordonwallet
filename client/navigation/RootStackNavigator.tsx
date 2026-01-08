import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import { useScreenOptions } from "@/hooks/useScreenOptions";

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

export type RootStackParamList = {
  Welcome: undefined;
  CreateWallet: undefined;
  ImportWallet: undefined;
  SetupPin: undefined;
  BackupWarning: { seedPhrase: string[] };
  SeedPhrase: { seedPhrase: string[] };
  Unlock: undefined;
  Main: undefined;
  Send: { tokenSymbol?: string } | undefined;
  Receive: { walletAddress: string };
  AssetDetail: { tokenSymbol: string; balance: string };
  TransactionDetail: { txHash: string };
  WalletManager: undefined;
  Approvals: undefined;
  PolicySettings: undefined;
  CreateBundle: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootStackNavigator() {
  const screenOptions = useScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions} initialRouteName="Welcome">
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
        options={{ headerTitle: "Approvals", presentation: "modal" }}
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
    </Stack.Navigator>
  );
}
