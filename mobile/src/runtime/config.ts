// ─── CHANGE THIS to your ngrok/server URL when sharing with testers ──────────
// Local USB (your own device via adb reverse):  http://127.0.0.1:8000
// ngrok tunnel:                                 https://abc123.ngrok-free.app
// Deployed server:                              https://your-server.com
export const API_BASE_URL = 'https://facialrecognizationapp-production.up.railway.app';

export const RUNTIME_NOTES = {
  androidUsb: 'Use adb reverse tcp:8000 tcp:8000 before launching the app on a physical Android device.',
  androidEmulator: 'Switch API_BASE_URL to http://10.0.2.2:8000 when testing on the standard Android emulator.',
  ngrok: 'Set API_BASE_URL to your ngrok HTTPS URL so testers without ADB can connect.',
};