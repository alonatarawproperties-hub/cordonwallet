require("react-native-get-random-values");
var Buffer = require("buffer").Buffer;
var process = require("process");

if (typeof global !== "undefined" && !global.Buffer) global.Buffer = Buffer;
if (typeof window !== "undefined" && !window.Buffer) window.Buffer = Buffer;

if (typeof global !== "undefined" && !global.process) global.process = process;
if (typeof window !== "undefined" && !window.process) window.process = process;
