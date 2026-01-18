// global.js
import "react-native-get-random-values";
import { Buffer } from "buffer";
import process from "process";

// IMPORTANT: use globalThis (works on web + native)
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = process;
globalThis.process.env = globalThis.process.env || {};

// Debug proof it runs first
console.log("[global.js] injected. Buffer?", !!globalThis.Buffer);
