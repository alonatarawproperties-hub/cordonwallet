import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import HeaderTitle from "@/components/HeaderTitle";

import PortfolioScreen from "@/screens/PortfolioScreen";
import ActivityScreen from "@/screens/ActivityScreen";
import BrowserScreen from "@/screens/BrowserScreen";
import BundlesScreen from "@/screens/BundlesScreen";
import SettingsScreen from "@/screens/SettingsScreen";

export type MainTabParamList = {
  Portfolio: undefined;
  Activity: undefined;
  Browser: undefined;
  Bundles: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  const { theme, isDark } = useTheme();
  const screenOptions = useScreenOptions();

  return (
    <Tab.Navigator
      initialRouteName="Portfolio"
      screenOptions={{
        ...screenOptions,
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
        tabBarStyle: {
          position: "absolute",
          backgroundColor: Platform.select({
            ios: "transparent",
            android: theme.backgroundRoot,
          }),
          borderTopWidth: 0,
          elevation: 0,
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
          headerTitle: () => <HeaderTitle />,
          tabBarIcon: ({ color, size }) => (
            <Feather name="pie-chart" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Activity"
        component={ActivityScreen}
        options={{
          headerTitle: "Activity",
          tabBarIcon: ({ color, size }) => (
            <Feather name="activity" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Browser"
        component={BrowserScreen}
        options={{
          headerTitle: "dApps",
          tabBarIcon: ({ color, size }) => (
            <Feather name="globe" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Bundles"
        component={BundlesScreen}
        options={{
          headerTitle: "Bundles",
          tabBarIcon: ({ color, size }) => (
            <Feather name="layers" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerTitle: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Feather name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
