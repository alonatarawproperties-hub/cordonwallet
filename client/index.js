// Polyfills - fallback in case metro polyfill didn't run
require("react-native-get-random-values");
const { Buffer } = require("buffer");
if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;
if (typeof global !== "undefined" && !global.Buffer) global.Buffer = Buffer;

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
