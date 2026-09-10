import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wacrm.app',
  appName: 'WA CRM',
  webDir: 'capacitor-dist',
  server: {
    url: 'https://wacem.netlify.app',
    cleartext: true,
    androidScheme: 'https',
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
