import React, {useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {AuthClient} from './AuthClient';
import CameraCapture from '../face/CameraCapture';
import {EmbeddingEngine} from '../face/EmbeddingEngine';
import {FaceCaptureSample, LivenessChecks} from '../face/LivenessChecks';
import {MatchService} from '../face/MatchService';
import {BiometricStore} from '../../security/BiometricStore';
import {cyberTheme} from '../../theme/cyberTheme';

type LoginScreenProps = {
  onGoEnroll?: () => void;
  onGoMfa?: () => void;
  onGoLive?: () => void;
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

function LoginScreen({onGoEnroll, onGoLive, onLoginSuccess}: LoginScreenProps) {
  const [busy, setBusy] = useState(false);
  const [openPreviewToken, setOpenPreviewToken] = useState<number | undefined>(undefined);
  const [captureRequestToken, setCaptureRequestToken] = useState<number | undefined>(undefined);
  const [captureSample, setCaptureSample] = useState<FaceCaptureSample | null>(null);
  const [captureMeta, setCaptureMeta] = useState('Camera stays off until you tap Login with Face.');
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuthTimeout = () => {
    if (!authTimeoutRef.current) {
      return;
    }
    clearTimeout(authTimeoutRef.current);
    authTimeoutRef.current = null;
  };

  const authenticateWithSample = async (sample: FaceCaptureSample) => {
    const binding = await BiometricStore.getDeviceBinding();
    const enrolledTemplate = await BiometricStore.getTemplate();
    if (!binding || !enrolledTemplate) {
      Alert.alert('Not enrolled', 'Enroll face login on this device first.');
      return;
    }

    if (!sample.imageBase64) {
      throw new Error('Image capture failed. Please retake the face photo.');
    }

    setCaptureMeta('Scanning face...');
    const analysis = await AuthClient.analyzeFace(sample.imageBase64);
    if (!analysis.face_detected) {
      setCaptureMeta('Face not detected. Try better framing and lighting.');
      throw new Error(analysis.message);
    }

    const challenge = await AuthClient.createChallenge(binding.username, binding.deviceId, 'face-primary');
    const candidateTemplate = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);
    const match = MatchService.compare(candidateTemplate, enrolledTemplate);
    const liveness = LivenessChecks.evaluate(sample);

    if (!match.matched) {
      setCaptureMeta(`Face not recognized (${match.similarity.toFixed(2)}).`);
      throw new Error(`Face mismatch (similarity ${match.similarity.toFixed(2)}).`);
    }

    const session = await AuthClient.verifyChallenge(
      challenge.challenge_id,
      binding.username,
      binding.deviceId,
      match.matched && liveness.passed,
      liveness.score,
      buildAssertion(challenge.challenge_id, challenge.nonce, binding.bindingKeyId),
    );

    setCaptureMeta(`Face recognized as ${session.username}.`);
    Alert.alert('Face login success', `Authenticated as ${session.username} via ${session.auth_method}.`);
    onLoginSuccess?.(session.username);
  };

  const onFaceLogin = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setCaptureSample(null);
    setCaptureMeta('Opening camera and capturing secure frame...');
    try {
      clearAuthTimeout();
      // Open the camera preview immediately, then wait 2 s for the camera
      // hardware to warm up before requesting a capture. Without this delay
      // the first capture attempt fires before the Camera component has
      // finished initialising its preview stream and always returns null.
      setOpenPreviewToken(token => (token ?? 0) + 1);
      setTimeout(() => {
        setCaptureRequestToken(token => (token ?? 0) + 1);
        // Total timeout = camera-warm-up delay + 15 s capture window
        authTimeoutRef.current = setTimeout(() => {
          setBusy(false);
          setCaptureMeta('Face capture timed out. Please try again.');
        }, 15000);
      }, 2000);
    } catch (error) {
      clearAuthTimeout();
      Alert.alert('Face login failed', error instanceof Error ? error.message : 'Unknown error');
      setBusy(false);
    }
  };

  const onCaptureError = (message: string) => {
    clearAuthTimeout();
    if (busy) {
      setBusy(false);
    }
    setCaptureMeta(message);
  };

  const onCaptureSampleReady = async (sample: FaceCaptureSample) => {
    clearAuthTimeout();
    setCaptureSample(sample);
    if (!busy) {
      setCaptureMeta(`Secure frame captured • ${sample.captureId}.`);
      return;
    }

    try {
      await authenticateWithSample(sample);
    } catch (error) {
      Alert.alert('Face login failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.brandHeader}>
        <View style={styles.logoOuter}>
          <View style={styles.logoInner}>
            <View style={styles.logoFace} />
            <View style={styles.logoScanLine} />
          </View>
        </View>
        <Text style={styles.title}>FaceAuth</Text>
        <Text style={styles.subtitle}>Secure biometric authentication</Text>
      </View>

      <CameraCapture
        label="Login capture"
        disabled={busy}
        openPreviewToken={openPreviewToken}
        captureRequestToken={captureRequestToken}
        actionsMode="none"
        onCaptureSample={onCaptureSampleReady}
        onCaptureError={onCaptureError}
      />

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Face status</Text>
        <Text style={styles.captureMeta}>{captureMeta}</Text>
      </View>

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={onFaceLogin} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Authenticating...' : 'Login with Face'}</Text>
      </Pressable>

      <Pressable style={styles.buttonSecondary} onPress={onGoEnroll} disabled={!onGoEnroll || busy}>
        <Text style={styles.buttonSecondaryText}>Enroll Face</Text>
      </Pressable>

      <View style={styles.row}>
        <Text style={styles.link}>Camera</Text>
        <Text style={styles.link}>Face Scan</Text>
        <Text style={styles.link}>Shield</Text>
        <Text style={styles.link}>User</Text>
        <Text style={styles.link}>Lock</Text>
      </View>

      <Pressable style={styles.liveButton} onPress={onGoLive} disabled={!onGoLive}>
        <Text style={styles.liveButtonText}>Open Live Detection</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: cyberTheme.spacing.outer,
    backgroundColor: cyberTheme.colors.background,
    flexGrow: 1,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  logoOuter: {
    width: 74,
    height: 74,
    borderRadius: 20,
    backgroundColor: '#101318',
    borderWidth: 1,
    borderColor: '#1d2b1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    ...cyberTheme.shadow.glow,
  },
  logoInner: {
    width: 50,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: cyberTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoFace: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#9DFD8C',
  },
  logoScanLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: cyberTheme.colors.accent,
    top: 16,
    opacity: 0.85,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: cyberTheme.colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    color: cyberTheme.colors.textSecondary,
    marginBottom: 12,
    lineHeight: 20,
    textAlign: 'center',
  },
  captureMeta: {
    color: '#9dfd8c',
    fontWeight: '600',
    lineHeight: 20,
  },
  statusCard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    backgroundColor: cyberTheme.colors.surfaceSoft,
  },
  statusLabel: {
    color: cyberTheme.colors.textSecondary,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  button: {
    borderWidth: 1,
    borderColor: '#7DFF69',
    borderRadius: 14,
    padding: 15,
    marginBottom: 14,
    backgroundColor: cyberTheme.colors.accent,
    alignItems: 'center',
    ...cyberTheme.shadow.glow,
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
    borderColor: '#2ba30f',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: '#031207',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonSecondaryText: {
    color: '#9DFF8A',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 12,
  },
  link: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveButton: {
    marginTop: 2,
    backgroundColor: '#10171f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2ba30f',
    padding: 14,
    alignItems: 'center',
  },
  liveButtonText: {
    color: '#90ff81',
    fontWeight: '800',
  },
});

export default LoginScreen;
