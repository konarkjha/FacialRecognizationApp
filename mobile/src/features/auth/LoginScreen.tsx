import React, {useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {AuthClient} from './AuthClient';
import CameraCapture from '../face/CameraCapture';
import {EmbeddingEngine, PoseKey} from '../face/EmbeddingEngine';
import {FaceCaptureSample} from '../face/LivenessChecks';
import {BiometricStore} from '../../security/BiometricStore';
import {cyberTheme} from '../../theme/cyberTheme';

type LoginScreenProps = {
  onGoEnroll?: () => void;
  onGoMfa?: () => void;
  onGoLive?: () => void;
  onLoginSuccess?: (username: string) => void;
};

const LOGIN_POSE_FLOW: Array<{key: PoseKey; label: string; instruction: string}> = [
  {key: 'front', label: 'Front', instruction: 'Look straight at camera'},
  {key: 'left', label: 'Left', instruction: 'Turn face slightly LEFT'},
  {key: 'right', label: 'Right', instruction: 'Turn face slightly RIGHT'},
];

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
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [capturedPoseCount, setCapturedPoseCount] = useState(0);
  const [openPreviewToken, setOpenPreviewToken] = useState<number | undefined>(undefined);
  const [captureRequestToken, setCaptureRequestToken] = useState<number | undefined>(undefined);
  const [flipRequestToken, setFlipRequestToken] = useState<number | undefined>(undefined);
  const [captureMeta, setCaptureMeta] = useState('Fast login captures 3 quick angles automatically: front, left, right.');
  const [serverOverallScore, setServerOverallScore] = useState<number | null>(null);
  const [serverRequiredScore, setServerRequiredScore] = useState<number | null>(null);
  const [serverPoseScores, setServerPoseScores] = useState<Partial<Record<PoseKey, number>>>({});
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureInFlightRef = useRef(false);
  const capturedSamplesRef = useRef<Partial<Record<PoseKey, FaceCaptureSample>>>({});

  const currentPose = LOGIN_POSE_FLOW[currentPoseIndex];

  const clearAuthTimeout = () => {
    if (!authTimeoutRef.current) {
      return;
    }
    clearTimeout(authTimeoutRef.current);
    authTimeoutRef.current = null;
  };

  const authenticateWithProfile = async (candidatePoseVectors: Record<string, number[]>, clientLivenessScore: number) => {
    const binding = await BiometricStore.getDeviceBinding();
    if (!binding) {
      Alert.alert('Not enrolled', 'Enroll face login on this device first.');
      return;
    }

    const challenge = await AuthClient.createChallenge(binding.username, binding.deviceId, 'face-primary');

    const session = await AuthClient.verifyChallenge(
      challenge.challenge_id,
      binding.username,
      binding.deviceId,
      true,
      clientLivenessScore,
      buildAssertion(challenge.challenge_id, challenge.nonce, binding.bindingKeyId),
      false,
      candidatePoseVectors,
      70,
    );

    const fallbackLocalScore = 0;
    const serverOverall = typeof session.match_score === 'number' ? session.match_score : fallbackLocalScore;
    const required = typeof session.match_required === 'number' ? session.match_required : 70;
    const poseScores = session.pose_scores ?? {};
    const normalizedPoseScores: Partial<Record<PoseKey, number>> = {
      front: typeof poseScores.front === 'number' ? poseScores.front : undefined,
      left: typeof poseScores.left === 'number' ? poseScores.left : undefined,
      right: typeof poseScores.right === 'number' ? poseScores.right : undefined,
      up: typeof poseScores.up === 'number' ? poseScores.up : undefined,
      down: typeof poseScores.down === 'number' ? poseScores.down : undefined,
    };
    const poseOrder: Array<{key: string; label: string}> = [
      {key: 'front', label: 'Front'},
      {key: 'left', label: 'Left'},
      {key: 'right', label: 'Right'},
      {key: 'up', label: 'Up'},
      {key: 'down', label: 'Down'},
    ];
    const breakdown = poseOrder
      .filter(item => typeof poseScores[item.key] === 'number')
      .map(item => `${item.label}: ${poseScores[item.key].toFixed(1)}%`)
      .join(' • ');

    setServerOverallScore(serverOverall);
    setServerRequiredScore(required);
    setServerPoseScores(normalizedPoseScores);
    setCaptureMeta(`Face recognized. Server score ${serverOverall.toFixed(1)}% as ${session.username}.`);
    Alert.alert(
      'Face login success',
      `Authenticated as ${session.username} via ${session.auth_method}.\n\nServer score: ${serverOverall.toFixed(1)}% (required ${required.toFixed(1)}%)${breakdown ? `\n${breakdown}` : ''}`,
    );
    onLoginSuccess?.(session.username);
  };

  const onStartGuidedLogin = async () => {
    if (busy) {
      return;
    }

    capturedSamplesRef.current = {};
    setCurrentPoseIndex(0);
    setCapturedPoseCount(0);
    setServerOverallScore(null);
    setServerRequiredScore(null);
    setServerPoseScores({});
    setBusy(true);
    captureInFlightRef.current = false;

    setCaptureMeta('Opening camera...');
    setOpenPreviewToken(token => (token ?? 0) + 1);
    setTimeout(() => {
      setCaptureMeta(`Fast capture: ${LOGIN_POSE_FLOW[0].label} pose`);
      setCaptureRequestToken(token => (token ?? 0) + 1);
    }, 800);
  };

  const onResetGuidedLogin = () => {
    capturedSamplesRef.current = {};
    setCurrentPoseIndex(0);
    setCapturedPoseCount(0);
    setBusy(false);
    setServerOverallScore(null);
    setServerRequiredScore(null);
    setServerPoseScores({});
    setCaptureRequestToken(undefined);
    captureInFlightRef.current = false;
    clearAuthTimeout();
    setCaptureMeta('Fast login reset. Auto capture will use front, left, and right poses.');
  };

  const onFlipCamera = () => {
    setFlipRequestToken(token => (token ?? 0) + 1);
  };

  const onCaptureError = (message: string) => {
    clearAuthTimeout();
    if (busy) {
      setBusy(false);
    }
    setCaptureMeta(message);
  };

  const finalizeFastLogin = async () => {
    const samples = capturedSamplesRef.current;
    const flow = LOGIN_POSE_FLOW;

    setCaptureMeta('Analyzing 3 frames in parallel...');

    const analysisResults = await Promise.all(
      flow.map(async pose => {
        const sample = samples[pose.key];
        if (!sample?.imageBase64) {
          throw new Error(`Missing ${pose.label} frame.`);
        }
        const analysis = await AuthClient.analyzeFace(sample.imageBase64);
        if (!analysis.face_detected) {
          throw new Error(`No face detected for ${pose.label} pose. ${analysis.message}`);
        }
        if (!analysis.is_live) {
          throw new Error(`Liveness failed for ${pose.label} pose (score ${analysis.liveness_score.toFixed(2)}).`);
        }
        return {pose, sample, analysis};
      }),
    );

    const frontEmbedding = EmbeddingEngine.fromAnalysis(analysisResults[0].analysis.vector, analysisResults[0].analysis.template_hash);
    const leftEmbedding = EmbeddingEngine.fromAnalysis(analysisResults[1].analysis.vector, analysisResults[1].analysis.template_hash);
    const rightEmbedding = EmbeddingEngine.fromAnalysis(analysisResults[2].analysis.vector, analysisResults[2].analysis.template_hash);

    const candidatePoseVectors = {
      front: frontEmbedding.vector,
      left: leftEmbedding.vector,
      right: rightEmbedding.vector,
    };

    const avgLiveness = analysisResults.reduce((sum, item) => sum + item.analysis.liveness_score, 0) / analysisResults.length;
    await authenticateWithProfile(candidatePoseVectors, avgLiveness);
  };

  const onCaptureSampleReady = async (sample: FaceCaptureSample) => {
    clearAuthTimeout();
    if (!currentPose || !busy || captureInFlightRef.current) {
      return;
    }
    captureInFlightRef.current = true;

    if (!sample.imageBase64) {
      captureInFlightRef.current = false;
      Alert.alert('Capture failed', 'Image capture failed. Please retake this pose.');
      return;
    }

    try {
      capturedSamplesRef.current = {...capturedSamplesRef.current, [currentPose.key]: sample};
      setCapturedPoseCount(value => value + 1);

      if (currentPoseIndex < LOGIN_POSE_FLOW.length - 1) {
        const nextIndex = currentPoseIndex + 1;
        setCurrentPoseIndex(nextIndex);
        setCaptureMeta(`Captured ${currentPose.label}. Next auto capture: ${LOGIN_POSE_FLOW[nextIndex].label}`);
        setTimeout(() => {
          setCaptureRequestToken(token => (token ?? 0) + 1);
        }, 450);
      } else {
        setCaptureMeta('Frames captured. Verifying...');
        await finalizeFastLogin();
        setBusy(false);
      }
    } catch (error) {
      Alert.alert('Face login failed', error instanceof Error ? error.message : 'Unknown error');
      setBusy(false);
    } finally {
      captureInFlightRef.current = false;
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
        actionsMode="none"
        captureMode="single"
        openPreviewToken={openPreviewToken}
        captureRequestToken={captureRequestToken}
        flipRequestToken={flipRequestToken}
        onCaptureSample={onCaptureSampleReady}
        onCaptureError={onCaptureError}
      />

      <Pressable style={styles.flipScreenButton} onPress={onFlipCamera}>
        <Text style={styles.flipScreenButtonText}>Flip Camera</Text>
      </Pressable>

      <View style={styles.poseGuideCard}>
        <Text style={styles.poseGuideLabel}>Current login pose</Text>
        <Text style={styles.poseGuideTitle}>{currentPose ? currentPose.label.toUpperCase() : 'DONE'}</Text>
        <Text style={styles.poseGuideHint}>{currentPose ? currentPose.instruction : 'All poses captured'}</Text>
        <Text style={styles.poseGuideProgress}>{capturedPoseCount} / {LOGIN_POSE_FLOW.length} captured</Text>
      </View>

      {/* ── Status Card ───────────────────────────────────── */}
      <View style={styles.statusCard}>
        <View style={styles.statusCardHeader}>
          <View style={[styles.statusDot, busy && styles.statusDotActive]} />
          <Text style={styles.statusLabel}>Status</Text>
        </View>
        <Text style={styles.captureMeta}>{captureMeta}</Text>
        {serverOverallScore !== null ? (
          <>
            <Text style={styles.serverScoreHeadline}>
              Server score {serverOverallScore.toFixed(1)}% (required {(serverRequiredScore ?? 70).toFixed(1)}%)
            </Text>
            <View style={styles.poseScoreRow}>
              {LOGIN_POSE_FLOW.map(item => {
                const value = serverPoseScores[item.key];
                const toneStyle =
                  typeof value !== 'number'
                    ? styles.poseScoreNeutral
                    : value >= 80
                    ? styles.poseScoreGood
                    : value >= 70
                    ? styles.poseScoreWarn
                    : styles.poseScoreBad;

                return (
                  <View key={item.key} style={[styles.poseScoreChip, toneStyle]}>
                    <Text style={styles.poseScoreLabel}>{item.label}</Text>
                    <Text style={styles.poseScoreValue}>{typeof value === 'number' ? `${value.toFixed(1)}%` : '--'}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </View>

      {/* ── Primary Action ────────────────────────────────── */}
      <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} onPress={onStartGuidedLogin} disabled={busy}>
        <Text style={styles.primaryButtonText}>{busy ? 'Fast Login Running...' : 'Start Fast Login'}</Text>
      </Pressable>

      <Pressable style={[styles.resetButton, busy && styles.buttonDisabled]} onPress={onResetGuidedLogin} disabled={busy}>
        <Text style={styles.resetButtonText}>Reset Poses</Text>
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
  serverScoreHeadline: {
    color: cyberTheme.colors.accentGold,
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  poseScoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  poseScoreChip: {
    minWidth: 74,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  poseScoreNeutral: {
    borderColor: cyberTheme.colors.border,
    backgroundColor: cyberTheme.colors.surface,
  },
  poseScoreGood: {
    borderColor: '#22C55E',
    backgroundColor: '#22C55E22',
  },
  poseScoreWarn: {
    borderColor: '#F7B731',
    backgroundColor: '#F7B73122',
  },
  poseScoreBad: {
    borderColor: '#FF4D6D',
    backgroundColor: '#FF4D6D22',
  },
  poseScoreLabel: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  poseScoreValue: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  poseGuideCard: {
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  poseGuideLabel: {
    color: cyberTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  poseGuideTitle: {
    color: cyberTheme.colors.accent,
    fontSize: 17,
    fontWeight: '900',
  },
  poseGuideHint: {
    color: cyberTheme.colors.textSecondary,
    marginTop: 2,
  },
  poseGuideProgress: {
    color: cyberTheme.colors.accentGold,
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  flipScreenButton: {
    alignSelf: 'flex-end',
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: cyberTheme.colors.accentViolet,
    borderRadius: cyberTheme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  flipScreenButtonText: {
    color: cyberTheme.colors.accentViolet,
    fontWeight: '700',
    fontSize: 12,
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
  resetButton: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: cyberTheme.colors.surfaceHigh,
  },
  resetButtonText: {
    color: cyberTheme.colors.textSecondary,
    fontWeight: '700',
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
