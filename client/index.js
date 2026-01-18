// Polyfills MUST run first - use only require() here, NO import statements
require("react-native-get-random-values");
const { Buffer } = require("buffer");
const process = require("process");

// Use globalThis for web + native compatibility
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = process;
globalThis.process.env = globalThis.process.env || {};
if (!globalThis.global) globalThis.global = globalThis;

console.log("[client/index.js] Polyfills injected. Buffer:", !!globalThis.Buffer);

// Now import the rest using require to ensure polyfills are set first
const { registerRootComponent } = require("expo");
const { LogBox } = require("react-native");
const App = require("@/App").default;

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
