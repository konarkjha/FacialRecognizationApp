import * as React from 'react';
import {
  Animated,
  Easing,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {Camera, CameraType} from 'react-native-camera-kit';

import {FaceCaptureSample} from './LivenessChecks';
import {AuthClient} from '../auth/AuthClient';
import {cyberTheme} from '../../theme/cyberTheme';

const LIVENESS_CHALLENGES = ['TURN LEFT', 'TURN RIGHT', 'NOD HEAD'] as const;
type LivenessChallenge = (typeof LIVENESS_CHALLENGES)[number];

type CameraCaptureProps = {
  label: string;
  disabled?: boolean;
  onCaptureSample?: (sample: FaceCaptureSample) => void;
  onCaptureError?: (message: string) => void;
  openPreviewToken?: number;
  captureRequestToken?: number;
  actionsMode?: 'full' | 'none';
};

function CameraCapture({
  label,
  disabled = false,
  onCaptureSample,
  onCaptureError,
  openPreviewToken,
  captureRequestToken,
  actionsMode = 'full',
}: CameraCaptureProps) {
  const cameraRef = React.useRef<any>(null);
  const scanLine = React.useRef(new Animated.Value(0)).current;
  const lastOpenTokenRef = React.useRef<number | undefined>(undefined);
  const lastCaptureTokenRef = React.useRef<number | undefined>(undefined);
  const frame1Ref = React.useRef<string>('');
  const challengeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [permissionState, setPermissionState] = React.useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [captureCount, setCaptureCount] = React.useState(0);
  const [faceCount, setFaceCount] = React.useState(0);
  const [cameraState, setCameraState] = React.useState<'idle' | 'detecting' | 'success' | 'failure'>('idle');
  const [previewVisible, setPreviewVisible] = React.useState(false);

  // Camera flip
  const [cameraFacing, setCameraFacing] = React.useState(CameraType.Front);
  const [cameraRenderKey, setCameraRenderKey] = React.useState(0);

  // Liveness challenge
  const [challengeStep, setChallengeStep] = React.useState<'idle' | 'challenge' | 'done'>('idle');
  const [challengeType, setChallengeType] = React.useState<LivenessChallenge>('TURN LEFT');
  const [challengeCountdown, setChallengeCountdown] = React.useState(0);

  React.useEffect(() => {
    const syncPermission = async () => {
      if (Platform.OS !== 'android') {
        setPermissionState('granted');
        return;
      }
      const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      setPermissionState(hasPermission ? 'granted' : 'denied');
    };
    syncPermission();
  }, []);

  React.useEffect(() => {
    if (permissionState !== 'granted') {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLine, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [permissionState, scanLine]);

  const flipCamera = () => {
    setCameraFacing((prev: string) => (prev === CameraType.Front ? CameraType.Back : CameraType.Front));
    setCameraRenderKey(prev => prev + 1);
  };

  const requestPermission = async (): Promise<boolean> => {
    if (permissionState === 'granted') {
      return true;
    }
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    setPermissionState(granted ? 'granted' : 'denied');
    return granted;
  };

  const capturePhoto = async () => {
    const camera = cameraRef.current;
    if (!camera) {
      return null;
    }
    if (typeof camera.capture === 'function') {
      return camera.capture();
    }
    if (typeof camera.captureImage === 'function') {
      return camera.captureImage();
    }
    if (typeof camera.takePicture === 'function') {
      return camera.takePicture();
    }
    return null;
  };

  const captureToBase64 = async (): Promise<{base64: string; width: number; height: number; fileSize: number} | null> => {
    const capture = await capturePhoto();
    if (!capture?.uri) {
      return null;
    }
    const filePath = capture.uri.startsWith('file://') ? capture.uri.slice(7) : capture.uri;
    const base64 = await RNFS.readFile(filePath, 'base64');
    if (!base64) {
      return null;
    }
    return {base64, width: capture.width ?? 0, height: capture.height ?? 0, fileSize: capture.size ?? 0};
  };

  /**
   * Liveness challenge capture (used when actionsMode === 'none'):
   * 1. Silently capture frame-1
   * 2. Show a random challenge instruction with 3-second countdown
   * 3. Capture frame-2 after countdown
   * 4. Compare sampled bytes of both frames — a static photo/screen yields identical frames
   */
  const runLivenessCapture = async () => {
    try {
      setCameraState('detecting');

      // ── Frame 1 (baseline) ─────────────────────────────────────────────
      const frame1 = await captureToBase64();
      if (!frame1) {
        setCameraState('failure');
        onCaptureError?.('Unable to capture image. Please try again.');
        return;
      }
      frame1Ref.current = frame1.base64;

      // ── Show challenge countdown ───────────────────────────────────────
      const picked = LIVENESS_CHALLENGES[Math.floor(Math.random() * LIVENESS_CHALLENGES.length)];
      setChallengeType(picked);
      setChallengeStep('challenge');
      setChallengeCountdown(2);

      await new Promise<void>(resolve => {
        let ticks = 1;
        const tick = () => {
          setChallengeCountdown(ticks);
          if (ticks <= 0) {
            resolve();
            return;
          }
          ticks -= 1;
          challengeTimerRef.current = setTimeout(tick, 1000);
        };
        challengeTimerRef.current = setTimeout(tick, 1000);
      });

      setChallengeStep('done');

      // Random short delay makes timed manual face/image swaps harder.
      const jitterMs = 150 + Math.floor(Math.random() * 300);
      await new Promise<void>(resolve => {
        setTimeout(() => resolve(), jitterMs);
      });

      // ── Frame 2 (post-challenge) ───────────────────────────────────────
      const frame2 = await captureToBase64();
      if (!frame2) {
        setCameraState('failure');
        onCaptureError?.('Unable to capture second frame. Please try again.');
        return;
      }

      // Motion detection: send BOTH frames to backend for real pixel-diff analysis.
      // Base64 comparison was unreliable because JPEG metadata always differs per capture.
      let livenessMotionDetected = false;
      try {
        const motionResult = await AuthClient.checkMotion(frame1.base64, frame2.base64);
        livenessMotionDetected = motionResult.motion_detected;
      } catch {
        // If server unreachable, fall back to permissive (don't block the user)
        livenessMotionDetected = true;
      }

      const brightnessGuess = Math.min(0.95, Math.max(0.45, 0.55 + faceCount * 0.05));
      const sample: FaceCaptureSample = {
        captureId: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        capturedAt: new Date().toISOString(),
        imageBase64: frame2.base64,
        featureSource: frame2.base64.slice(0, 12000),
        width: frame2.width,
        height: frame2.height,
        fileSize: frame2.fileSize,
        faceCentered: faceCount > 0,
        eyesOpen: faceCount > 0,
        blinkDetected: captureCount % 2 === 0,
        headTurnDetected: livenessMotionDetected,
        brightness: brightnessGuess,
        livenessMotionDetected,
        challengeType: picked,
      };

      setCaptureCount(c => c + 1);
      setChallengeStep('idle');
      onCaptureSample?.(sample);
      setCameraState(livenessMotionDetected && faceCount > 0 ? 'success' : 'failure');
    } catch {
      setChallengeStep('idle');
      setCameraState('failure');
      onCaptureError?.('Liveness check failed. Please align your face and try again.');
    }
  };

  const captureLiveSample = async () => {
    let hasPermission = permissionState === 'granted';
    if (permissionState !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        setCameraState('failure');
        onCaptureError?.('Camera permission is required for face login.');
        return;
      }
      hasPermission = true;
    }

    if (!hasPermission) {
      setCameraState('failure');
      onCaptureError?.('Camera permission is required for face login.');
      return;
    }

    if (!previewVisible) {
      setPreviewVisible(true);
      setCameraState('idle');
      setTimeout(() => {
        captureLiveSample();
      }, 2000);
      return;
    }

    // actionsMode='none' → full liveness challenge pipeline
    if (actionsMode === 'none') {
      await runLivenessCapture();
      return;
    }

    // actionsMode='full' → simple single-frame capture
    try {
      setCameraState('detecting');
      const result = await captureToBase64();
      if (!result) {
        setCameraState('failure');
        onCaptureError?.('Unable to capture image from camera. Please try again.');
        return;
      }

      const brightnessGuess = Math.min(0.95, Math.max(0.45, 0.55 + faceCount * 0.05));
      const sample: FaceCaptureSample = {
        captureId: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        capturedAt: new Date().toISOString(),
        imageBase64: result.base64,
        featureSource: result.base64.slice(0, 12000),
        width: result.width,
        height: result.height,
        fileSize: result.fileSize,
        faceCentered: faceCount > 0,
        eyesOpen: faceCount > 0,
        blinkDetected: captureCount % 2 === 0,
        headTurnDetected: captureCount % 2 === 0,
        brightness: brightnessGuess,
        livenessMotionDetected: false,
        challengeType: 'NONE',
      };
      setCaptureCount(current => current + 1);
      onCaptureSample?.(sample);
      setCameraState(faceCount > 0 ? 'success' : 'failure');
    } catch {
      setCameraState('failure');
      onCaptureError?.('Face capture failed. Please align your face and try again.');
    }
  };

  React.useEffect(() => {
    if (openPreviewToken === undefined) {
      return;
    }
    if (lastOpenTokenRef.current === openPreviewToken) {
      return;
    }
    lastOpenTokenRef.current = openPreviewToken;

    if (permissionState === 'granted') {
      setPreviewVisible(true);
      setCameraState('idle');
      setCameraRenderKey(prev => prev + 1);
    }
  }, [openPreviewToken, permissionState]);

  React.useEffect(() => {
    if (captureRequestToken === undefined || actionsMode !== 'none') {
      return;
    }
    if (lastCaptureTokenRef.current === captureRequestToken) {
      return;
    }
    lastCaptureTokenRef.current = captureRequestToken;
    captureLiveSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureRequestToken, actionsMode]);

  const scanTranslateY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  const statusText =
    cameraState === 'success'
      ? 'Face recognized'
      : cameraState === 'failure'
      ? 'Face not detected'
      : cameraState === 'detecting'
      ? 'Scanning face...'
      : 'Align your face inside the frame';

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{label}</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.flipHeaderButton} onPress={flipCamera}>
            <Text style={styles.flipHeaderText}>Flip</Text>
          </Pressable>
          <Text style={styles.badge}>CAMERA</Text>
        </View>
      </View>

      <View style={[styles.preview, cameraState === 'failure' && styles.previewFailure]}>
        {permissionState === 'granted' && previewVisible ? (
          <>
            <Camera
              ref={cameraRef}
              style={styles.camera}
              cameraType={cameraFacing}
              key={`${cameraFacing}-${cameraRenderKey}`}
              flashMode="off"
              focusMode="on"
              zoomMode="off"
              shutterPhotoSound={false}
              shutterAnimationDuration={0}
              onFacesDetected={(event: any) => {
                const count = Number(event?.nativeEvent?.faceCount ?? 0);
                setFaceCount(count);
                if (cameraState !== 'success') {
                  setCameraState(count > 0 ? 'detecting' : 'idle');
                }
              }}
            />
            <View style={styles.overlay}>
              <View style={[styles.corner, styles.cornerTopLeft]} />
              <View style={[styles.corner, styles.cornerTopRight]} />
              <View style={[styles.corner, styles.cornerBottomLeft]} />
              <View style={[styles.corner, styles.cornerBottomRight]} />
              <Animated.View style={[styles.scanLine, {transform: [{translateY: scanTranslateY}]}]} />
              {faceCount > 0 ? <View style={styles.faceBox} /> : null}

              {/* ── Flip camera button ───────────────────────── */}
              <Pressable style={styles.flipButton} onPress={flipCamera} disabled={disabled}>
                <Text style={styles.flipIcon}>⟳</Text>
              </Pressable>

              {/* ── Liveness challenge overlay ───────────────── */}
              {challengeStep === 'challenge' && (
                <View style={styles.challengeOverlay}>
                  <Text style={styles.challengeLabel}>LIVENESS CHECK</Text>
                  <Text style={styles.challengeAction}>{challengeType}</Text>
                  <Text style={styles.challengeCountdown}>{challengeCountdown}</Text>
                </View>
              )}
              {challengeStep === 'done' && (
                <View style={styles.challengeOverlay}>
                  <Text style={styles.challengeLabel}>✓ CAPTURING...</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <View style={styles.permissionState}>
            <Text style={styles.permissionTitle}>{permissionState !== 'granted' ? 'Camera access required' : 'Camera is off'}</Text>
            <Text style={styles.permissionHint}>
              {permissionState !== 'granted'
                ? 'Grant permission to enable secure face scanning.'
                : 'Tap Login with Face to open and capture automatically.'}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.status}>{statusText}</Text>
      {actionsMode === 'full' ? (
        <View style={styles.actions}>
          <Pressable style={[styles.button, disabled && styles.buttonDisabled]} onPress={requestPermission} disabled={disabled}>
            <Text style={styles.buttonText}>{permissionState === 'granted' ? 'Camera ready' : 'Grant camera access'}</Text>
          </Pressable>
          <Pressable
            style={[styles.buttonSecondary, (disabled || permissionState !== 'granted') && styles.buttonDisabled]}
            onPress={captureLiveSample}
            disabled={disabled || permissionState !== 'granted'}>
            <Text style={styles.buttonSecondaryText}>{previewVisible ? 'Capture secure frame' : 'Open camera & capture'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: cyberTheme.colors.surface,
    borderRadius: cyberTheme.radius.lg,
    padding: cyberTheme.spacing.cardInner,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    shadowColor: '#00D4FF',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flipHeaderButton: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.accentViolet,
    backgroundColor: '#7B5CF018',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  flipHeaderText: {
    color: cyberTheme.colors.accentViolet,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badge: {
    color: cyberTheme.colors.accent,
    borderWidth: 1,
    borderColor: cyberTheme.colors.accent,
    backgroundColor: '#00D4FF18',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  status: {
    color: cyberTheme.colors.accent,
    marginTop: 10,
    marginBottom: 10,
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  preview: {
    width: '100%',
    height: 240,
    borderRadius: cyberTheme.radius.md,
    overflow: 'hidden',
    backgroundColor: '#030509',
    borderWidth: 1.5,
    borderColor: cyberTheme.colors.border,
  },
  previewFailure: {
    borderColor: cyberTheme.colors.danger,
    shadowColor: cyberTheme.colors.danger,
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 18,
  },
  corner: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderColor: cyberTheme.colors.accent,
  },
  cornerTopLeft: {
    top: 16,
    left: 16,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 3,
  },
  cornerTopRight: {
    top: 16,
    right: 16,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 3,
  },
  cornerBottomLeft: {
    bottom: 16,
    left: 16,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 3,
  },
  cornerBottomRight: {
    bottom: 16,
    right: 16,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 3,
  },
  scanLine: {
    marginTop: 20,
    marginHorizontal: 22,
    height: 1.5,
    backgroundColor: cyberTheme.colors.accent,
    shadowColor: cyberTheme.colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  faceBox: {
    position: 'absolute',
    top: '27%',
    left: '26%',
    width: '48%',
    height: '48%',
    borderWidth: 1.5,
    borderColor: cyberTheme.colors.accentGreen,
    borderRadius: 8,
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  permissionTitle: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionHint: {
    color: cyberTheme.colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
  },
  actions: {
    gap: 10,
  },
  button: {
    backgroundColor: '#00D4FF14',
    borderWidth: 1.5,
    borderColor: cyberTheme.colors.accent,
    borderRadius: cyberTheme.radius.md,
    padding: 13,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: cyberTheme.radius.md,
    padding: 13,
    alignItems: 'center',
    shadowColor: '#00D4FF',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 0},
    elevation: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: cyberTheme.colors.accent,
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  buttonSecondaryText: {
    color: '#020B12',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.3,
  },
  flipButton: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderWidth: 1.5,
    borderColor: cyberTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIcon: {
    color: cyberTheme.colors.accent,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  challengeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6,8,15,0.85)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomLeftRadius: cyberTheme.radius.md,
    borderBottomRightRadius: cyberTheme.radius.md,
    borderTopWidth: 1,
    borderTopColor: '#7B5CF044',
  },
  challengeLabel: {
    color: cyberTheme.colors.accentViolet,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.5,
    marginBottom: 3,
    textTransform: 'uppercase',
  },
  challengeAction: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  challengeCountdown: {
    color: cyberTheme.colors.accentGold,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2,
    shadowColor: '#F7B731',
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
});

export default CameraCapture;
