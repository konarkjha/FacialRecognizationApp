# Local run

## Backend
1. Create a virtual environment.
2. Install dependencies from `backend/requirements.txt`.
3. Start the API from `backend`:
   - `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

## Mobile on a real Android phone via USB
1. Install Node.js 18+ and Android platform tools (`adb`) on your Linux machine.
2. On the phone, enable Developer Options and USB debugging.
3. Connect the phone by cable and verify it appears with `adb devices`.
4. From `mobile`, install dependencies if needed.
5. Start the backend on port `8000`.
6. Run `adb reverse tcp:8000 tcp:8000` so the phone can reach the local FastAPI service at `127.0.0.1:8000`.
7. Generate the native Android shell if needed with the React Native CLI.
8. Start Metro and run the Android app on the connected device.

## Debian/Ubuntu Android SDK setup (required for this project)
If `npm run android` fails with SDK or license errors, install Android SDK components:

1. Install packages:
   - `sudo apt update`
   - `sudo apt install -y openjdk-17-jdk adb android-sdk-platform-tools google-android-cmdline-tools-13.0-installer`
2. Set Java in shell startup:
   - `echo 'export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64' >> ~/.bashrc`
   - `echo 'export PATH=$JAVA_HOME/bin:$PATH' >> ~/.bashrc`
   - `source ~/.bashrc`
3. Install SDK components and accept licenses:
   - `sudo /usr/bin/sdkmanager --sdk_root=/usr/lib/android-sdk --licenses`
   - `sudo /usr/bin/sdkmanager --sdk_root=/usr/lib/android-sdk "platform-tools" "platforms;android-34" "build-tools;34.0.0"`
4. Point Gradle to SDK (already configured in this repo):
   - `mobile/android/local.properties` should contain `sdk.dir=/usr/lib/android-sdk`
5. Re-run build:
   - `cd /home/konarkjha/Desktop/WORK/ollama/mobile && npm run android`

## Current device-testing behavior
- The app now asks for camera permission in the UI.
- After granting permission, use the capture button to generate a live sample.
- Enrollment, face-primary login, and face-MFA all require a captured live sample.
- Backend now uses OpenCV YuNet face detection plus SFace neural embeddings, so only the detected face region is matched.
- Re-enroll after backend/model changes because older templates are not compatible with the neural embedding pipeline.
- The login screen now includes a live detection mode that opens a continuous front-camera feed and analyzes frames in near real time.
- Liveness is still placeholder logic for now; it is useful for flow testing on your S25 Ultra, not for production security.

## Notes
- The mobile API URL is currently set to `127.0.0.1:8000` for USB device testing with `adb reverse`.
- For the Android emulator, change the API base URL to `10.0.2.2:8000` in [mobile/src/runtime/config.ts](mobile/src/runtime/config.ts).
- Neural face models are stored in [backend/models](backend/models).
- The current liveness pipeline is still a placeholder, so this is not yet equivalent to Windows Hello-grade spoof resistance.
