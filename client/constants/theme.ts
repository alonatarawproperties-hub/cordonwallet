import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#0B0F14",
    textSecondary: "#6B7280",
    buttonText: "#FFFFFF",
    tabIconDefault: "#6B7280",
    tabIconSelected: "#667EEA",
    link: "#667EEA",
    accent: "#667EEA",
    accentSecondary: "#4F46E5",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
    backgroundRoot: "#FFFFFF",
    backgroundDefault: "#F7F8FA",
    backgroundSecondary: "#E5E7EB",
    backgroundTertiary: "#D1D5DB",
    border: "#E5E7EB",
    glass: "rgba(255, 255, 255, 0.8)",
    glassBorder: "rgba(0, 0, 0, 0.08)",
    glow: "rgba(102, 126, 234, 0.25)",
  },
  dark: {
    text: "#FFFFFF",
    textSecondary: "#8B92A8",
    buttonText: "#FFFFFF",
    tabIconDefault: "#8B92A8",
    tabIconSelected: "#667EEA",
    link: "#667EEA",
    accent: "#667EEA",
    accentSecondary: "#4F46E5",
    success: "#10B981",
    warning: "#F59E0B",
    danger: "#EF4444",
    backgroundRoot: "#0A0E13",
    backgroundDefault: "#0F1318",
    backgroundSecondary: "rgba(20, 25, 35, 0.6)",
    backgroundTertiary: "rgba(30, 35, 50, 0.8)",
    border: "rgba(255, 255, 255, 0.08)",
    glass: "rgba(20, 25, 35, 0.6)",
    glassBorder: "rgba(255, 255, 255, 0.08)",
    glow: "rgba(102, 126, 234, 0.25)",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 24,
    fontWeight: "700" as const,
  },
  h3: {
    fontSize: 18,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 12,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    fontWeight: "500" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
