// metro.config.js
console.log("[metro.config] loaded");

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Ensure buffer/process resolve correctly
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  buffer: require.resolve("buffer/"),
  process: require.resolve("process/"),
};

// CRITICAL: run our shim before the app entry on ALL platforms including web
const prev = config.serializer.getModulesRunBeforeMainModule;
config.serializer.getModulesRunBeforeMainModule = () => {
  const prevList = prev ? prev() : [];
  return [require.resolve("./global.js"), ...prevList];
};

module.exports = config;
