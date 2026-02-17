import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { PortfolioHeaderTitle, PortfolioHeaderLeft, PortfolioHeaderRight } from "@/components/PortfolioHeader";

import PortfolioScreen from "@/screens/PortfolioScreen";
import ActivityScreen from "@/screens/ActivityScreen";
import BrowserScreen from "@/screens/BrowserScreen";
import MultisigScreen from "@/screens/MultisigScreen";
import BundlesScreen from "@/screens/BundlesScreen";

export type MainTabParamList = {
  Portfolio: undefined;
  Activity: undefined;
  Browser: undefined;
  Multisig: undefined;
  Bundles: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Tab.Navigator
      initialRouteName="Portfolio"
      screenOptions={{
        headerTitleAlign: "center",
        headerTintColor: theme.text,
        headerTransparent: true,
        headerBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={80}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundRoot }]} />
          ),
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.tabIconDefault,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "500",
          letterSpacing: 0.2,
        },
        tabBarItemStyle: {
          paddingTop: 4,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.select({
            ios: "transparent",
            android: theme.backgroundRoot,
          }),
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
          elevation: 0,
          paddingBottom: Platform.select({ ios: 0, android: 8 }),
        },
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : null,
      }}
    >
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{
          headerTitle: () => <PortfolioHeaderTitle />,
          headerLeft: () => <PortfolioHeaderLeft />,
          headerRight: () => <PortfolioHeaderRight />,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "pie-chart" : "pie-chart-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{
          headerTitle: "Activity",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "pulse" : "pulse-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Browser"
        component={BrowserScreen}
        options={{
          headerTitle: "Browser",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "compass" : "compass-outline"} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Multisig"
        component={MultisigScreen}
        options={{
          headerTitle: "Multisig",
          tabBarIcon: ({ size }) => (
            <View style={{ opacity: 0.35 }}>
              <Ionicons name="people-outline" size={size} color={theme.tabIconDefault} />
              <View style={{ position: "absolute", right: -4, top: -3 }}>
                <Ionicons name="lock-closed" size={10} color={theme.tabIconDefault} />
              </View>
            </View>
          ),
          tabBarLabel: "Multisig",
          tabBarLabelStyle: { opacity: 0.35 },
        }}
      />
      <Tab.Screen
        name="Bundles"
        component={BundlesScreen}
        options={{
          headerTitle: "Bundles",
          tabBarIcon: ({ size }) => (
            <View style={{ opacity: 0.35 }}>
              <Ionicons name="layers-outline" size={size} color={theme.tabIconDefault} />
              <View style={{ position: "absolute", right: -4, top: -3 }}>
                <Ionicons name="lock-closed" size={10} color={theme.tabIconDefault} />
              </View>
            </View>
          ),
          tabBarLabelStyle: { opacity: 0.35 },
        }}
      />
    </Tab.Navigator>
  );
}
