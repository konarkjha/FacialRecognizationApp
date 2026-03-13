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

    // Anti-spoofing: reject if backend texture analysis flags image as non-live
    if (!analysis.is_live) {
      setCaptureMeta(`Anti-spoofing check failed (score ${analysis.liveness_score.toFixed(2)}). Use a real live face.`);
      throw new Error('Liveness check failed — photo or screen replay detected. Please look directly at the camera.');
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
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* ── Brand Header ──────────────────────────────────── */}
      <View style={styles.brandHeader}>
        <View style={styles.logoShell}>
          <View style={styles.logoRing}>
            <View style={styles.logoDot} />
          </View>
          <View style={styles.logoScanLine} />
        </View>
        <Text style={styles.appName}>FaceAuth<Text style={styles.appNameAccent}>.</Text></Text>
        <Text style={styles.subtitle}>Biometric authentication powered by AI</Text>
        <View style={styles.securityBadgeRow}>
          <View style={styles.securityBadge}><Text style={styles.securityBadgeText}>AES-256</Text></View>
          <View style={[styles.securityBadge, styles.securityBadgeViolet]}><Text style={[styles.securityBadgeText, styles.securityBadgeTextViolet]}>ANTI-SPOOF</Text></View>
          <View style={[styles.securityBadge, styles.securityBadgeGold]}><Text style={[styles.securityBadgeText, styles.securityBadgeTextGold]}>LIVENESS</Text></View>
        </View>
      </View>

      {/* ── Camera ────────────────────────────────────────── */}
      <CameraCapture
        label="Biometric scan"
        disabled={busy}
        openPreviewToken={openPreviewToken}
        captureRequestToken={captureRequestToken}
        actionsMode="none"
        onCaptureSample={onCaptureSampleReady}
        onCaptureError={onCaptureError}
      />

      {/* ── Status Card ───────────────────────────────────── */}
      <View style={styles.statusCard}>
        <View style={styles.statusCardHeader}>
          <View style={[styles.statusDot, busy && styles.statusDotActive]} />
          <Text style={styles.statusLabel}>Status</Text>
        </View>
        <Text style={styles.captureMeta}>{captureMeta}</Text>
      </View>

      {/* ── Primary Action ────────────────────────────────── */}
      <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} onPress={onFaceLogin} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Authenticating…' : 'Login with Face'}</Text>
      </Pressable>

      {/* ── Secondary Action ──────────────────────────────── */}
      <Pressable style={styles.secondaryButton} onPress={onGoEnroll} disabled={!onGoEnroll || busy}>
        <Text style={styles.secondaryButtonText}>Create account  →</Text>
      </Pressable>

      {/* ── Divider ───────────────────────────────────────── */}
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>TOOLS</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable style={styles.outlineButton} onPress={onGoLive} disabled={!onGoLive}>
        <Text style={styles.outlineButtonText}>Open Live Detection</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: cyberTheme.spacing.outer,
    paddingTop: 28,
    paddingBottom: 40,
    backgroundColor: cyberTheme.colors.background,
    flexGrow: 1,
  },
  // ── Brand Header ──────────────────────────────────────────
  brandHeader: {
    alignItems: 'center',
    marginBottom: 26,
  },
  logoShell: {
    width: 80,
    height: 80,
    borderRadius: cyberTheme.radius.xl,
    backgroundColor: '#0A0E1A',
    borderWidth: 1.5,
    borderColor: '#00D4FF44',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#00D4FF',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: {width: 0, height: 0},
    elevation: 16,
  },
  logoRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: cyberTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: cyberTheme.colors.accent,
    opacity: 0.9,
  },
  logoScanLine: {
    position: 'absolute',
    width: 46,
    height: 1.5,
    backgroundColor: cyberTheme.colors.accent,
    opacity: 0.6,
  },
  appName: {
    fontSize: 38,
    fontWeight: '900',
    color: cyberTheme.colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 5,
  },
  appNameAccent: {
    color: cyberTheme.colors.accent,
  },
  subtitle: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 14,
  },
  securityBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  securityBadge: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.accent,
    backgroundColor: '#00D4FF12',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  securityBadgeViolet: {
    borderColor: cyberTheme.colors.accentViolet,
    backgroundColor: '#7B5CF012',
  },
  securityBadgeGold: {
    borderColor: cyberTheme.colors.accentGold,
    backgroundColor: '#F7B73112',
  },
  securityBadgeText: {
    color: cyberTheme.colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  securityBadgeTextViolet: {
    color: cyberTheme.colors.accentViolet,
  },
  securityBadgeTextGold: {
    color: cyberTheme.colors.accentGold,
  },
  // ── Status Card ───────────────────────────────────────────
  statusCard: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    padding: 14,
    marginBottom: 16,
    backgroundColor: cyberTheme.colors.surfaceHigh,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: cyberTheme.colors.textMuted,
  },
  statusDotActive: {
    backgroundColor: cyberTheme.colors.accent,
    shadowColor: cyberTheme.colors.accent,
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  statusLabel: {
    color: cyberTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  captureMeta: {
    color: cyberTheme.colors.textSecondary,
    fontWeight: '500',
    lineHeight: 20,
    fontSize: 13,
  },
  // ── Buttons ───────────────────────────────────────────────
  primaryButton: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: cyberTheme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#00D4FF',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 14,
  },
  primaryButtonText: {
    color: '#020E14',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderWidth: 1.5,
    borderColor: cyberTheme.colors.accentViolet,
    borderRadius: cyberTheme.radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 22,
  },
  secondaryButtonText: {
    color: cyberTheme.colors.accentViolet,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  // ── Divider ───────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: cyberTheme.colors.border,
  },
  dividerText: {
    color: cyberTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    paddingVertical: 13,
    alignItems: 'center',
  },
  outlineButtonText: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});

export default LoginScreen;
