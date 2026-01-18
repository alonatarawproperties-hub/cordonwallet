// global.js
import "react-native-get-random-values";
import { Buffer } from "buffer";
import process from "process";

if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = process;
globalThis.process.env = globalThis.process.env || {};

// Some libs expect `global`
if (!globalThis.global) globalThis.global = globalThis;

console.log("[global.js] injected early. Buffer:", !!globalThis.Buffer);
