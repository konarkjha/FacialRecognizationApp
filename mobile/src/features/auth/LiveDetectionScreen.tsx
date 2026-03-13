import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  Easing,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {Camera, CameraType} from 'react-native-camera-kit';

import {AuthClient} from './AuthClient';
import {EmbeddingEngine} from '../face/EmbeddingEngine';
import {MatchService} from '../face/MatchService';
import {BiometricStore} from '../../security/BiometricStore';
import {cyberTheme} from '../../theme/cyberTheme';

type LiveDetectionScreenProps = {
  onGoLogin?: () => void;
  onLoginSuccess?: (username: string) => void;
};

function buildAssertion(challengeId: string, nonce: string, bindingKeyId: string): string {
  let hash = 0;
  const value = `${challengeId}:${nonce}:${bindingKeyId}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function LiveDetectionScreen({onGoLogin, onLoginSuccess}: LiveDetectionScreenProps) {
  const cameraRef = useRef<any>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const stableMatchesRef = useRef(0);
  const facePresentRef = useRef(false);
  const lastRecognitionAttemptRef = useRef(0);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready to start live detection');
  const [busy, setBusy] = useState(false);
  const [recognizedUser, setRecognizedUser] = useState<string | null>(null);
  const [lastSimilarity, setLastSimilarity] = useState<number | null>(null);
  const [stableMatches, setStableMatches] = useState(0);
  const [cameraType, setCameraType] = useState<string>(CameraType.Front);
  const [faceCount, setFaceCount] = useState(0);
  const scanLine = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  const canScan = useMemo(() => permission === 'granted' && !busy, [permission, busy]);

  const requestPermission = async () => {
    if (Platform.OS !== 'android') {
      setPermission('granted');
      return true;
    }

    try {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      const allowed = granted === PermissionsAndroid.RESULTS.GRANTED;
      setPermission(allowed ? 'granted' : 'denied');
      return allowed;
    } catch {
      setPermission('denied');
      return false;
    }
  };

  const stopLoop = () => {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  };

  useEffect(() => {
    requestPermission();
    return () => stopLoop();
  }, []);

  useEffect(() => {
    const lineLoop = Animated.loop(
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

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {toValue: 1, duration: 900, useNativeDriver: true}),
        Animated.timing(pulse, {toValue: 0, duration: 900, useNativeDriver: true}),
      ]),
    );

    lineLoop.start();
    pulseLoop.start();
    return () => {
      lineLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, scanLine]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    stableMatchesRef.current = stableMatches;
  }, [stableMatches]);

  const handleFrame = async (imageBase64: string) => {
    if (!runningRef.current || busyRef.current) {
      return;
    }

    setBusy(true);
    busyRef.current = true;
    try {
      const binding = await BiometricStore.getDeviceBinding();
      const enrolledTemplate = await BiometricStore.getTemplate();
      if (!binding || !enrolledTemplate) {
        setStatus('Enroll a face before live detection');
        setRunning(false);
        runningRef.current = false;
        stopLoop();
        return;
      }

      const analysis = await AuthClient.analyzeFace(imageBase64);

      if (!analysis.face_detected) {
        setRecognizedUser(null);
        setStableMatches(0);
        setLastSimilarity(null);
        stableMatchesRef.current = 0;
        setStatus(facePresentRef.current ? 'Face seen in preview, aligning for recognition...' : 'No face detected in live preview');
      } else {
        const candidateTemplate = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);
        const match = MatchService.compare(candidateTemplate, enrolledTemplate);
        setLastSimilarity(match.similarity);

        if (match.matched) {
          const nextStableMatches = stableMatchesRef.current + 1;
          stableMatchesRef.current = nextStableMatches;
          setStableMatches(nextStableMatches);
          setRecognizedUser(binding.username);
          setStatus(`Live match: ${binding.username} (${match.similarity.toFixed(2)})`);

          if (nextStableMatches >= 2) {
            const challenge = await AuthClient.createChallenge(binding.username, binding.deviceId, 'face-primary');
            const session = await AuthClient.verifyChallenge(
              challenge.challenge_id,
              binding.username,
              binding.deviceId,
              true,
              Math.max(analysis.confidence, 0.8),
              buildAssertion(challenge.challenge_id, challenge.nonce, binding.bindingKeyId),
            );
            setStatus(`Recognized ${session.username} live via ${session.auth_method}`);
            setRunning(false);
            runningRef.current = false;
            stopLoop();
            Alert.alert('Live recognition success', `Recognized ${session.username} in live feed.`);
            onLoginSuccess?.(session.username);
          }
        } else {
          setRecognizedUser(null);
          setStableMatches(0);
          stableMatchesRef.current = 0;
          setStatus(`Face not recognized (${match.similarity.toFixed(2)})`);
        }
      }
    } catch (error) {
      setStableMatches(0);
      stableMatchesRef.current = 0;
      setRecognizedUser(null);
      setStatus(error instanceof Error ? error.message : 'Live detection failed');
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const captureAndAnalyze = async () => {
    if (!runningRef.current || busyRef.current) {
      return;
    }

    if (!facePresentRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastRecognitionAttemptRef.current < 2800) {
      return;
    }
    lastRecognitionAttemptRef.current = now;

    try {
      const capture = await cameraRef.current?.capture();
      if (!capture?.uri) {
        setPermission('denied');
        setStatus('Unable to capture frame from camera view');
        return;
      }

      const filePath = capture.uri.startsWith('file://') ? capture.uri.slice(7) : capture.uri;
      const base64 = await RNFS.readFile(filePath, 'base64');
      if (!base64) {
        setStatus('Captured frame is empty. Try again with better lighting.');
        return;
      }

      setPermission('granted');
      await handleFrame(`data:image/jpeg;base64,${base64}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Frame capture failed');
    }
  };

  const startLoop = () => {
    stopLoop();
    loopRef.current = setInterval(() => {
      captureAndAnalyze();
    }, 500);
  };

  const scanTranslateY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 290],
  });

  const frameOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 0.95],
  });

  const statusColor = status.toLowerCase().includes('recognized')
    ? '#86EFAC'
    : status.toLowerCase().includes('no face') || status.toLowerCase().includes('failed')
    ? '#F87171'
    : '#A3E635';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Live Face Detection</Text>
      <Text style={styles.subtitle}>Realtime biometric scanning with cyber-secure camera pipeline.</Text>

      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.meta}>Camera permission: {permission}</Text>
          <Text style={styles.modeBadge}>{cameraType === CameraType.Front ? 'Selfie camera' : 'Back camera'}</Text>
        </View>
        <View style={styles.preview}>
          {permission === 'granted' ? (
            <>
              <Camera
                ref={cameraRef}
                style={styles.camera}
                cameraType={cameraType}
                flashMode="off"
                focusMode="on"
                zoomMode="off"
                shutterPhotoSound={false}
                shutterAnimationDuration={0}
                onFacesDetected={(event: any) => {
                  const count = Number(event?.nativeEvent?.faceCount ?? 0);
                  setFaceCount(count);
                  facePresentRef.current = count > 0;

                  if (!runningRef.current) {
                    setStatus(count > 0 ? 'Face visible in live preview' : 'Align your face inside the frame');
                    return;
                  }

                  if (count > 0 && !busyRef.current && !recognizedUser) {
                    setStatus('Scanning face...');
                  }

                  if (count === 0) {
                    stableMatchesRef.current = 0;
                    setStableMatches(0);
                    setRecognizedUser(null);
                    setLastSimilarity(null);
                    setStatus('Face not detected');
                  }
                }}
                onError={(event: any) => {
                  setStatus(`Camera error: ${event?.nativeEvent?.errorMessage ?? 'Unknown camera error'}`);
                }}
              />
              <View style={styles.overlay}>
                <Animated.View style={[styles.scanLine, {transform: [{translateY: scanTranslateY}]}]} />
                <Animated.View style={[styles.scanFrame, {opacity: frameOpacity}]} />
                <View style={[styles.corner, styles.cornerTopLeft]} />
                <View style={[styles.corner, styles.cornerTopRight]} />
                <View style={[styles.corner, styles.cornerBottomLeft]} />
                <View style={[styles.corner, styles.cornerBottomRight]} />
                {faceCount > 0 ? <View style={styles.faceBox} /> : null}
              </View>
            </>
          ) : (
            <View style={styles.previewPlaceholder}>
              <Text style={styles.previewText}>Camera permission required</Text>
              <Text style={styles.previewHint}>Grant camera access to show live view in this box.</Text>
            </View>
          )}
        </View>
        <Text style={[styles.status, {color: statusColor}]}>{status}</Text>
        <Text style={styles.meta}>Detected identity: {recognizedUser ?? 'none'}</Text>
        <Text style={styles.meta}>Faces in preview: {faceCount}</Text>
        <Text style={styles.meta}>Similarity: {lastSimilarity !== null ? lastSimilarity.toFixed(2) : '--'}</Text>
      </View>

      <View style={styles.rowButtons}>
        <Pressable
          style={[styles.halfButton, permission === 'granted' && styles.buttonAlt]}
          onPress={requestPermission}>
          <Text style={styles.buttonText}>{permission === 'granted' ? 'Permission ready' : 'Grant permission'}</Text>
        </Pressable>

        <Pressable
          style={[styles.halfButton, styles.rotateButton]}
          onPress={() => {
            setCameraType(current => (current === CameraType.Front ? CameraType.Back : CameraType.Front));
            setStatus('Camera rotated');
          }}>
          <Text style={styles.buttonText}>Rotate camera</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.buttonSecondary, (!canScan || running) && styles.buttonDisabled]}
        onPress={() => {
          setStableMatches(0);
          stableMatchesRef.current = 0;
          facePresentRef.current = false;
          setRecognizedUser(null);
          setStatus('Live detection started. Scanning automatically...');
          setRunning(true);
          runningRef.current = true;
          startLoop();
        }}
        disabled={!canScan || running}>
        <Text style={styles.buttonSecondaryText}>Start live detection</Text>
      </Pressable>

      <Pressable
        style={[styles.button, (!running || !canScan) && styles.buttonDisabled]}
        onPress={captureAndAnalyze}
        disabled={!running || !canScan}>
        <Text style={styles.buttonText}>Retry recognition</Text>
      </Pressable>

      <Pressable
        style={[styles.buttonStop, !running && styles.buttonDisabled]}
        onPress={() => {
          setRunning(false);
          runningRef.current = false;
          facePresentRef.current = false;
          stopLoop();
          setStatus('Live detection stopped');
        }}
        disabled={!running}>
        <Text style={styles.buttonText}>Stop live detection</Text>
      </Pressable>

      {onGoLogin ? (
        <Pressable style={styles.linkButton} onPress={onGoLogin}>
          <Text style={styles.linkText}>Back to login</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: cyberTheme.spacing.outer,
    backgroundColor: cyberTheme.colors.background,
    flexGrow: 1,
  },
  title: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    color: cyberTheme.colors.textSecondary,
    marginBottom: 14,
  },
  card: {
    backgroundColor: cyberTheme.colors.surface,
    borderRadius: 20,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1d2b1a',
    ...cyberTheme.shadow.glow,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  modeBadge: {
    color: '#9dfd8c',
    backgroundColor: '#132117',
    borderWidth: 1,
    borderColor: '#2ba30f',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
  },
  preview: {
    height: 360,
    borderRadius: 16,
    marginVertical: 12,
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#203126',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 22,
  },
  scanFrame: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#39FF14',
    borderRadius: 16,
  },
  scanLine: {
    position: 'absolute',
    left: 28,
    right: 28,
    height: 2,
    backgroundColor: '#39FF14',
    shadowColor: '#39FF14',
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  corner: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderColor: '#7DFF69',
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
  faceBox: {
    position: 'absolute',
    top: '31%',
    left: '30%',
    width: '40%',
    height: '40%',
    borderWidth: 2,
    borderColor: '#A3FF93',
    borderRadius: 10,
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  previewText: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  previewHint: {
    color: cyberTheme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  status: {
    fontWeight: '700',
    marginBottom: 8,
    minHeight: 20,
  },
  meta: {
    color: cyberTheme.colors.textSecondary,
    marginBottom: 4,
  },
  button: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2ba30f',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  halfButton: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2ba30f',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  buttonAlt: {
    backgroundColor: '#0f2a12',
  },
  rotateButton: {
    backgroundColor: '#15201A',
  },
  buttonSecondary: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
    ...cyberTheme.shadow.glow,
  },
  buttonStop: {
    backgroundColor: '#3A1218',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#9dfd8c',
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#031207',
    fontWeight: '800',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  linkText: {
    color: '#98ff8d',
    fontWeight: '700',
  },
});

export default LiveDetectionScreen;