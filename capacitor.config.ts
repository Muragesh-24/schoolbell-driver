import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.engigrow.schoolbell.driver",
  appName: "Schoolbell Driver",
  webDir: "dist",
  android: {
    allowMixedContent: true,
  },
  plugins: {
    BackgroundGeolocation: {
      // Plugin config handled in the watcher call
    },
  },
};

export default config;
