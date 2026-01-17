import { ExpoConfig, ConfigContext } from "expo/config";

const config = ({ config }: ConfigContext): ExpoConfig => ({
  name: "Cordon",
  slug: "cordon",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "cordon",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.cordon.app",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: ["cordon"],
        },
      ],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#0B0F14",
      foregroundImage: "./assets/images/icon.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: "com.cordon.app",
    permissions: [
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
    ],
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "cordon",
            host: "auth",
            pathPrefix: "/callback",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
  },
  web: {
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#0B0F14",
        dark: {
          backgroundColor: "#0B0F14",
        },
      },
    ],
    "expo-web-browser",
    [
      "expo-local-authentication",
      {
        faceIDPermission: "Allow Cordon to use Face ID for secure access.",
      },
    ],
    "expo-secure-store",
  ],
  experiments: {
    reactCompiler: true,
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  updates: {
    url: "https://u.expo.dev/73617114-5956-4f38-bfc1-d643e57b6947",
  },
  extra: {
    eas: {
      projectId: "73617114-5956-4f38-bfc1-d643e57b6947",
    },
    apiDomain: process.env.EXPO_PUBLIC_DOMAIN ?? "app.cordonwallet.com",
  },
});

export default config;
