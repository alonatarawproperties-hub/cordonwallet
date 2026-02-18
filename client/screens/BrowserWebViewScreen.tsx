import { useCallback, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, TextInput, Keyboard, Modal } from "react-native";
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
import { useWallet } from "@/lib/wallet-context";
import { buildInjectedJS } from "@/lib/browser/injected-provider";
import { useDAppBridge } from "@/lib/browser/useDAppBridge";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, "BrowserWebView">;

export default function BrowserWebViewScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { addRecent } = useBrowserStore();
  const { activeWallet } = useWallet();

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

  // Derive the page origin for display in the approval modal
  const pageOrigin = useMemo(() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return currentUrl;
    }
  }, [currentUrl]);

  // Build injected JS with the current wallet state
  const injectedJS = useMemo(
    () =>
      buildInjectedJS({
        publicKey: activeWallet?.addresses?.solana ?? null,
        isConnected: false, // Always start disconnected — dApp must call connect()
      }),
    [activeWallet],
  );

  // Wire up the dApp bridge (postMessage handler + approval state)
  const { handleMessage, pendingApproval, approveRequest, rejectRequest } =
    useDAppBridge(webViewRef, pageOrigin);

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

  // Label for the approval type
  const approvalTypeLabel = useMemo(() => {
    if (!pendingApproval) return "";
    switch (pendingApproval.type) {
      case "connect":
        return "Connect Wallet";
      case "signMessage":
        return "Sign Message";
      case "signTransaction":
        return "Sign Transaction";
      case "signAndSendTransaction":
        return "Sign & Send Transaction";
      case "signAllTransactions":
        return "Sign All Transactions";
      default:
        return "Request";
    }
  }, [pendingApproval]);

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
        onMessage={handleMessage}
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        startInLoadingState
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        userAgent="Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      />

      {/* Approval Modal */}
      <Modal
        visible={!!pendingApproval}
        transparent
        animationType="slide"
        onRequestClose={rejectRequest}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: theme.backgroundRoot,
                paddingBottom: insets.bottom + Spacing.lg,
              },
            ]}
          >
            {/* Header */}
            <View style={styles.modalHeader}>
              <View
                style={[
                  styles.modalIconContainer,
                  { backgroundColor: theme.accent + "20" },
                ]}
              >
                <Feather
                  name={pendingApproval?.type === "connect" ? "link-2" : "edit-3"}
                  size={24}
                  color={theme.accent}
                />
              </View>
              <ThemedText type="h3" style={styles.modalTitle}>
                {approvalTypeLabel}
              </ThemedText>
              <ThemedText
                type="caption"
                style={[styles.modalOrigin, { color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {pendingApproval?.origin}
              </ThemedText>
            </View>

            {/* Detail */}
            <View
              style={[
                styles.modalDetail,
                { backgroundColor: theme.backgroundDefault },
              ]}
            >
              <ThemedText type="body" style={{ textAlign: "center" }}>
                {pendingApproval?.origin}{" "}
                {pendingApproval?.detail}
              </ThemedText>
              {activeWallet?.addresses?.solana ? (
                <ThemedText
                  type="caption"
                  style={{
                    color: theme.textSecondary,
                    textAlign: "center",
                    marginTop: Spacing.xs,
                  }}
                  numberOfLines={1}
                >
                  {activeWallet.addresses.solana.slice(0, 8)}...
                  {activeWallet.addresses.solana.slice(-6)}
                </ThemedText>
              ) : null}
            </View>

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <Pressable
                onPress={rejectRequest}
                style={[
                  styles.modalBtn,
                  styles.modalBtnReject,
                  { borderColor: theme.border },
                ]}
              >
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Reject
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={approveRequest}
                style={[
                  styles.modalBtn,
                  styles.modalBtnApprove,
                  { backgroundColor: theme.accent },
                ]}
              >
                <ThemedText
                  type="body"
                  style={{ fontWeight: "600", color: "#FFFFFF" }}
                >
                  Approve
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  // Approval modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  modalHeader: {
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  modalIconContainer: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontWeight: "700",
  },
  modalOrigin: {
    fontSize: 13,
  },
  modalDetail: {
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modalBtn: {
    flex: 1,
    height: 50,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnReject: {
    borderWidth: 1,
  },
  modalBtnApprove: {},
});
