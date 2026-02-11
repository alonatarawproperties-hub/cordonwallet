import { useCallback, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, TextInput, Keyboard } from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { WebView, WebViewNavigation } from "react-native-webview";

import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { normalizeUrl, useBrowserStore } from "@/store/browserStore";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, "BrowserWebView">;

export default function BrowserWebViewScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { addRecent } = useBrowserStore();

  const webViewRef = useRef<WebView>(null);
  const initialUrl = useMemo(
    () => normalizeUrl(route.params.url),
    [route.params.url],
  );

  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressInput, setAddressInput] = useState(initialUrl);
  const [pageTitle, setPageTitle] = useState(route.params.title || "Browser");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const handleNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      setCurrentUrl(navState.url);
      setAddressInput(navState.url);
      setCanGoBack(navState.canGoBack);
      setCanGoForward(navState.canGoForward);
      if (navState.title) {
        setPageTitle(navState.title);
      }
    },
    [],
  );

  const handleSubmitAddress = useCallback(() => {
    try {
      const nextUrl = normalizeUrl(addressInput);
      webViewRef.current?.stopLoading();
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${JSON.stringify(nextUrl)}; true;`,
      );
      Keyboard.dismiss();
    } catch {
      setAddressInput(currentUrl);
    }
  }, [addressInput, currentUrl]);

  const handleLoadEnd = useCallback(async () => {
    try {
      await addRecent({
        url: currentUrl,
        title: pageTitle || "Untitled",
      });
    } catch {
      // no-op
    }
  }, [addRecent, currentUrl, pageTitle]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundRoot, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.topRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <Feather name="x" size={22} color={theme.text} />
          </Pressable>
          <ThemedText type="caption" numberOfLines={1} style={styles.title}>
            {pageTitle || "Browser"}
          </ThemedText>
          <View style={styles.iconBtn} />
        </View>

        <View
          style={[
            styles.addressBar,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <Feather name="lock" size={14} color={theme.textSecondary} />
          <TextInput
            value={addressInput}
            onChangeText={setAddressInput}
            onSubmitEditing={handleSubmitAddress}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            style={[styles.addressInput, { color: theme.text }]}
            placeholder="Enter URL"
            placeholderTextColor={theme.textSecondary}
          />
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={() => webViewRef.current?.goBack()}
            disabled={!canGoBack}
            style={[styles.controlBtn, !canGoBack && styles.controlBtnDisabled]}
          >
            <Feather
              name="chevron-left"
              size={18}
              color={canGoBack ? theme.text : theme.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => webViewRef.current?.goForward()}
            disabled={!canGoForward}
            style={[
              styles.controlBtn,
              !canGoForward && styles.controlBtnDisabled,
            ]}
          >
            <Feather
              name="chevron-right"
              size={18}
              color={canGoForward ? theme.text : theme.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => webViewRef.current?.reload()}
            style={styles.controlBtn}
          >
            <Feather name="rotate-cw" size={16} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <WebView
        ref={webViewRef}
        source={{ uri: initialUrl }}
        onNavigationStateChange={handleNavigationStateChange}
        onLoadEnd={handleLoadEnd}
        startInLoadingState
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    textAlign: "center",
    marginHorizontal: Spacing.sm,
  },
  iconBtn: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addressBar: {
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  addressInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  controlBtn: {
    padding: Spacing.xs,
  },
  controlBtnDisabled: {
    opacity: 0.45,
  },
});
