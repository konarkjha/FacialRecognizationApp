import React, {useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {AuthClient} from './AuthClient';
import CameraCapture from '../face/CameraCapture';
import {EmbeddingEngine, FaceEmbedding, MultiPoseFaceProfile, PoseKey} from '../face/EmbeddingEngine';
import {FaceCaptureSample} from '../face/LivenessChecks';
import {MatchService} from '../face/MatchService';
import {BiometricStore} from '../../security/BiometricStore';
import {cyberTheme} from '../../theme/cyberTheme';

type LoginScreenProps = {
  onGoEnroll?: () => void;
  onGoMfa?: () => void;
  onGoLive?: () => void;
  onLoginSuccess?: (username: string) => void;
};

const POSE_FLOW: Array<{key: PoseKey; label: string; instruction: string}> = [
  {key: 'front', label: 'Front', instruction: 'Look straight at camera'},
  {key: 'left', label: 'Left', instruction: 'Turn face slightly LEFT'},
  {key: 'right', label: 'Right', instruction: 'Turn face slightly RIGHT'},
  {key: 'up', label: 'Up', instruction: 'Lift chin UP slightly'},
  {key: 'down', label: 'Down', instruction: 'Lower chin DOWN slightly'},
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
  const [poseEmbeddings, setPoseEmbeddings] = useState<Partial<Record<PoseKey, FaceEmbedding>>>({});
  const [captureMeta, setCaptureMeta] = useState('Tap Start Guided Login, then capture each pose: front, left, right, up, down.');
  const [serverScoreSummary, setServerScoreSummary] = useState<string>('');
  const authTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPose = POSE_FLOW[currentPoseIndex];
  const allPosesCaptured = POSE_FLOW.every(item => Boolean(poseEmbeddings[item.key]));

  const clearAuthTimeout = () => {
    if (!authTimeoutRef.current) {
      return;
    }
    clearTimeout(authTimeoutRef.current);
    authTimeoutRef.current = null;
  };

  const authenticateWithProfile = async (candidateProfile: MultiPoseFaceProfile) => {
    const binding = await BiometricStore.getDeviceBinding();
    const enrolledProfile = await BiometricStore.getTemplateProfile();
    if (!binding || !enrolledProfile) {
      Alert.alert('Not enrolled', 'Enroll face login on this device first.');
      return;
    }

    const challenge = await AuthClient.createChallenge(binding.username, binding.deviceId, 'face-primary');
    const match = MatchService.compareMultiPose(candidateProfile, enrolledProfile);
    const candidatePoseVectors = {
      front: candidateProfile.poses.front.vector,
      left: candidateProfile.poses.left.vector,
      right: candidateProfile.poses.right.vector,
      up: candidateProfile.poses.up.vector,
      down: candidateProfile.poses.down.vector,
    };

    if (!match.matched) {
      setCaptureMeta(`Match score ${match.score.toFixed(1)}%. Need at least 70%.`);
      throw new Error(`Face mismatch. Match score ${match.score.toFixed(1)}% (required ≥ 70%).`);
    }

    const session = await AuthClient.verifyChallenge(
      challenge.challenge_id,
      binding.username,
      binding.deviceId,
      true,
      Math.min(1, match.score / 100),
      buildAssertion(challenge.challenge_id, challenge.nonce, binding.bindingKeyId),
      false,
      candidatePoseVectors,
      70,
    );

    const serverOverall = typeof session.match_score === 'number' ? session.match_score : match.score;
    const required = typeof session.match_required === 'number' ? session.match_required : 70;
    const poseScores = session.pose_scores ?? {};
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

    setServerScoreSummary(`Server score ${serverOverall.toFixed(1)}% (required ${required.toFixed(1)}%)${breakdown ? `\n${breakdown}` : ''}`);
    setCaptureMeta(`Face recognized. Server score ${serverOverall.toFixed(1)}% as ${session.username}.`);
    Alert.alert(
      'Face login success',
      `Authenticated as ${session.username} via ${session.auth_method}.\n\nServer score: ${serverOverall.toFixed(1)}% (required ${required.toFixed(1)}%)${breakdown ? `\n${breakdown}` : ''}`,
    );
    onLoginSuccess?.(session.username);
  };

  const onStartGuidedLogin = async () => {
    if (busy || allPosesCaptured) {
      return;
    }
    setCaptureMeta(`Capture ${currentPose.label} pose: ${currentPose.instruction}`);
  };

  const onResetGuidedLogin = () => {
    setPoseEmbeddings({});
    setCurrentPoseIndex(0);
    setBusy(false);
    clearAuthTimeout();
    setCaptureMeta('Guided login reset. Capture front, left, right, up, and down poses.');
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
    if (!currentPose || busy) {
      return;
    }

    if (!sample.imageBase64) {
      Alert.alert('Capture failed', 'Image capture failed. Please retake this pose.');
      return;
    }

    setBusy(true);

    try {
      const analysis = await AuthClient.analyzeFace(sample.imageBase64);
      if (!analysis.face_detected) {
        throw new Error(`No face detected for ${currentPose.label} pose. ${analysis.message}`);
      }
      if (!analysis.is_live) {
        throw new Error(`Liveness failed for ${currentPose.label} pose (score ${analysis.liveness_score.toFixed(2)}).`);
      }

      const embedding = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);
      const nextEmbeddings = {...poseEmbeddings, [currentPose.key]: embedding};
      setPoseEmbeddings(nextEmbeddings);

      if (currentPoseIndex < POSE_FLOW.length - 1) {
        setCurrentPoseIndex(index => index + 1);
        setCaptureMeta(`Captured ${currentPose.label}. Next: ${POSE_FLOW[currentPoseIndex + 1].instruction}`);
      } else {
        const profile: MultiPoseFaceProfile = {
          poses: {
            front: nextEmbeddings.front!,
            left: nextEmbeddings.left!,
            right: nextEmbeddings.right!,
            up: nextEmbeddings.up!,
            down: nextEmbeddings.down!,
          },
          capturedAt: new Date().toISOString(),
        };
        setCaptureMeta('All poses captured. Verifying profile...');
        await authenticateWithProfile(profile);
      }
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
        actionsMode="full"
        onCaptureSample={onCaptureSampleReady}
        onCaptureError={onCaptureError}
      />

      <View style={styles.poseGuideCard}>
        <Text style={styles.poseGuideLabel}>Current login pose</Text>
        <Text style={styles.poseGuideTitle}>{currentPose ? currentPose.label.toUpperCase() : 'DONE'}</Text>
        <Text style={styles.poseGuideHint}>{currentPose ? currentPose.instruction : 'All poses captured'}</Text>
        <Text style={styles.poseGuideProgress}>{Object.keys(poseEmbeddings).length} / {POSE_FLOW.length} captured</Text>
      </View>

      {/* ── Status Card ───────────────────────────────────── */}
      <View style={styles.statusCard}>
        <View style={styles.statusCardHeader}>
          <View style={[styles.statusDot, busy && styles.statusDotActive]} />
          <Text style={styles.statusLabel}>Status</Text>
        </View>
        <Text style={styles.captureMeta}>{captureMeta}</Text>
        {serverScoreSummary ? <Text style={styles.serverScoreText}>{serverScoreSummary}</Text> : null}
      </View>

      {/* ── Primary Action ────────────────────────────────── */}
      <Pressable style={[styles.primaryButton, busy && styles.buttonDisabled]} onPress={onStartGuidedLogin} disabled={busy || allPosesCaptured}>
        <Text style={styles.primaryButtonText}>{busy ? 'Processing...' : allPosesCaptured ? 'Poses complete' : 'Start Guided Login'}</Text>
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
  serverScoreText: {
    color: cyberTheme.colors.accentGold,
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
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
