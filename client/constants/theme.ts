import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#0B0F14",
    textSecondary: "#6B7280",
    buttonText: "#FFFFFF",
    tabIconDefault: "#6B7280",
    tabIconSelected: "#3B82F6",
    link: "#3B82F6",
    accent: "#3B82F6",
    success: "#22C55E",
    warning: "#F59E0B",
    danger: "#EF4444",
    backgroundRoot: "#FFFFFF",
    backgroundDefault: "#F7F8FA",
    backgroundSecondary: "#E5E7EB",
    backgroundTertiary: "#D1D5DB",
    border: "#E5E7EB",
  },
  dark: {
    text: "#F9FAFB",
    textSecondary: "#A1A1AA",
    buttonText: "#FFFFFF",
    tabIconDefault: "#A1A1AA",
    tabIconSelected: "#3B82F6",
    link: "#3B82F6",
    accent: "#3B82F6",
    success: "#22C55E",
    warning: "#F59E0B",
    danger: "#EF4444",
    backgroundRoot: "#0B0F14",
    backgroundDefault: "#111827",
    backgroundSecondary: "#1F2937",
    backgroundTertiary: "#374151",
    border: "#1F2937",
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
