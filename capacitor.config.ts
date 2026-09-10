import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wacrm.app',
  appName: 'WA CRM',
  webDir: 'public',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*'],
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
