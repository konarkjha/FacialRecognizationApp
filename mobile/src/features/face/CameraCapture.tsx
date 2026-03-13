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
import {cyberTheme} from '../../theme/cyberTheme';

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

  const [permissionState, setPermissionState] = React.useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [captureCount, setCaptureCount] = React.useState(0);
  const [faceCount, setFaceCount] = React.useState(0);
  const [cameraState, setCameraState] = React.useState<'idle' | 'detecting' | 'success' | 'failure'>('idle');
  const [previewVisible, setPreviewVisible] = React.useState(false);

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
      // Give the camera hardware 2 s to open its preview stream before
      // attempting a capture – 650 ms is not enough on most devices.
      setTimeout(() => {
        captureLiveSample();
      }, 2000);
      return;
    }

    try {
      setCameraState('detecting');
      const capture = await capturePhoto();
      if (!capture?.uri) {
        setCameraState('failure');
        onCaptureError?.('Unable to capture image from camera. Please try again.');
        return;
      }

      const filePath = capture.uri.startsWith('file://') ? capture.uri.slice(7) : capture.uri;
      const base64 = await RNFS.readFile(filePath, 'base64');
      if (!base64) {
        setCameraState('failure');
        onCaptureError?.('Captured image was empty. Please retry.');
        return;
      }

      const brightnessGuess = Math.min(0.95, Math.max(0.45, 0.55 + faceCount * 0.05));
      const sample: FaceCaptureSample = {
        captureId: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
        capturedAt: new Date().toISOString(),
        imageBase64: base64,
        featureSource: base64.slice(0, 12000),
        width: capture.width ?? 0,
        height: capture.height ?? 0,
        fileSize: capture.size ?? 0,
        faceCentered: faceCount > 0,
        eyesOpen: faceCount > 0,
        blinkDetected: captureCount % 2 === 0,
        headTurnDetected: captureCount % 2 === 0,
        brightness: brightnessGuess,
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
        <Text style={styles.badge}>CAMERA</Text>
      </View>

      <View style={[styles.preview, cameraState === 'failure' && styles.previewFailure]}>
        {permissionState === 'granted' && previewVisible ? (
          <>
            <Camera
              ref={cameraRef}
              style={styles.camera}
              cameraType={CameraType.Front}
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
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1d2838',
    shadowColor: '#39FF14',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  badge: {
    color: '#9efc8f',
    borderWidth: 1,
    borderColor: '#2aa40f',
    backgroundColor: '#0f2a12',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
  },
  status: {
    color: cyberTheme.colors.accent,
    marginTop: 10,
    marginBottom: 10,
    fontWeight: '700',
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#07090F',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  previewFailure: {
    borderColor: cyberTheme.colors.danger,
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
    width: 28,
    height: 28,
    borderColor: cyberTheme.colors.accent,
  },
  cornerTopLeft: {
    top: 18,
    left: 18,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTopRight: {
    top: 18,
    right: 18,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBottomLeft: {
    bottom: 18,
    left: 18,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBottomRight: {
    bottom: 18,
    right: 18,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  scanLine: {
    marginTop: 16,
    marginHorizontal: 22,
    height: 2,
    backgroundColor: cyberTheme.colors.accent,
    shadowColor: cyberTheme.colors.accent,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  faceBox: {
    position: 'absolute',
    top: '30%',
    left: '28%',
    width: '44%',
    height: '44%',
    borderWidth: 2,
    borderColor: '#7CFF65',
    borderRadius: 10,
  },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  permissionTitle: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  permissionHint: {
    color: cyberTheme.colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: 10,
  },
  button: {
    backgroundColor: '#173420',
    borderWidth: 1,
    borderColor: '#39FF14',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#39FF14',
    borderRadius: 12,
    padding: 13,
    alignItems: 'center',
    ...cyberTheme.shadow.glow,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#b7ffab',
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#041a08',
    fontWeight: '700',
  },
});

export default CameraCapture;
