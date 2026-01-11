import { registerRootComponent } from "expo";
import { LogBox } from "react-native";

import App from "@/App";

// Suppress WalletConnect SDK internal debug errors
LogBox.ignoreLogs([
  'No matching key. proposal',
  '{"context":"core/verify-api"',
  '{"context":"client"}',
  '{"context":"core"',
  /^\{"time":\d+,"level":\d+,"context":"core/,
  /^\{"time":\d+/,
]);

registerRootComponent(App);
