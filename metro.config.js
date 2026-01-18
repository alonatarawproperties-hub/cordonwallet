const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve("buffer/"),
  process: require.resolve("process/browser"),
};

const prevGetPolyfills = config.serializer.getPolyfills;
config.serializer.getPolyfills = (args) => {
  const polyfills = prevGetPolyfills ? prevGetPolyfills(args) : [];
  return [require.resolve("./global.js"), ...polyfills];
};

module.exports = config;
