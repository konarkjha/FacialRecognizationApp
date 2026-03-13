import React, {useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {AuthClient} from './AuthClient';
import CameraCapture from '../face/CameraCapture';
import {EmbeddingEngine, FaceEmbedding, MultiPoseFaceProfile, PoseKey} from '../face/EmbeddingEngine';
import {FaceCaptureSample} from '../face/LivenessChecks';
import {BiometricStore} from '../../security/BiometricStore';
import {cyberTheme} from '../../theme/cyberTheme';

function buildBindingKeyId(username: string, deviceId: string): string {
  return `${username}-${deviceId}-binding`;
}

type EnrollmentScreenProps = {
  onGoLogin?: () => void;
  onLoginSuccess?: (username: string) => void;
};

type CyberInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
};

const POSE_FLOW: Array<{key: PoseKey; label: string; instruction: string}> = [
  {key: 'front', label: 'Front', instruction: 'Look straight at the camera'},
  {key: 'left', label: 'Left', instruction: 'Turn your face slightly LEFT'},
  {key: 'right', label: 'Right', instruction: 'Turn your face slightly RIGHT'},
  {key: 'up', label: 'Up', instruction: 'Lift your chin a little UP'},
  {key: 'down', label: 'Down', instruction: 'Lower your chin a little DOWN'},
];

function CyberInput({label, value, onChangeText, secureTextEntry}: CyberInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
      <Text style={[styles.inputLabel, focused && styles.inputLabelActive]}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        placeholder=""
        placeholderTextColor={cyberTheme.colors.textMuted}
        cursorColor={cyberTheme.colors.accent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

function EnrollmentScreen({onGoLogin, onLoginSuccess}: EnrollmentScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('Android Demo Device');
  const [busy, setBusy] = useState(false);
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [poseEmbeddings, setPoseEmbeddings] = useState<Partial<Record<PoseKey, FaceEmbedding>>>({});
  const [captureStatus, setCaptureStatus] = useState('Capture all 5 guided poses to create your face profile.');
  const enrollInFlightRef = useRef(false);

  const currentPose = POSE_FLOW[currentPoseIndex];
  const allPosesCaptured = POSE_FLOW.every(item => Boolean(poseEmbeddings[item.key]));

  const onPoseCaptured = async (sample: FaceCaptureSample) => {
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
        throw new Error(`Liveness check failed on ${currentPose.label} pose (score ${analysis.liveness_score.toFixed(2)}).`);
      }

      const embedding = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);
      setPoseEmbeddings(prev => ({...prev, [currentPose.key]: embedding}));

      if (currentPoseIndex < POSE_FLOW.length - 1) {
        setCurrentPoseIndex(index => index + 1);
        setCaptureStatus(`Captured ${currentPose.label} pose. Next: ${POSE_FLOW[currentPoseIndex + 1].instruction}`);
      } else {
        setCaptureStatus('All 5 poses captured. You can now enroll face login.');
      }
    } catch (error) {
      Alert.alert('Capture invalid', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onEnroll = async () => {
    if (enrollInFlightRef.current) {
      return;
    }
    enrollInFlightRef.current = true;
    setBusy(true);
    try {
      const normalizedUsername = username.trim().toLowerCase();
      if (!normalizedUsername) {
        throw new Error('Enter a username before enrollment');
      }
      if (!password.trim()) {
        throw new Error('Enter a fallback PIN/password before enrollment');
      }

      if (!allPosesCaptured) {
        throw new Error('Capture all guided poses (Front, Left, Right, Up, Down) before enrollment');
      }

      const deviceId = `android-${normalizedUsername}`;
      const bindingKeyId = buildBindingKeyId(normalizedUsername, deviceId);

      let serverHasUser = false;
      let serverFaceEnrolled = false;
      try {
        const enrollmentStatus = await AuthClient.getEnrollmentStatus(normalizedUsername);
        serverHasUser = true;
        serverFaceEnrolled = enrollmentStatus.face_enrolled;
      } catch {
        serverHasUser = false;
      }

      const localBinding = await BiometricStore.getDeviceBinding();
      const localProfile = await BiometricStore.getTemplateProfile();
      const localAlreadyEnrolled =
        localBinding?.username === normalizedUsername && localBinding?.deviceId === deviceId && Boolean(localProfile);

      if (localAlreadyEnrolled || serverFaceEnrolled) {
        try {
          const existingSession = await AuthClient.passwordLogin(normalizedUsername, password);
          Alert.alert('Login success', `Welcome back, ${existingSession.username}.`);
          onLoginSuccess?.(existingSession.username);
          return;
        } catch {
          throw new Error('User already enrolled. Use the correct password to log in instead of enrolling again.');
        }
      }

      if (serverHasUser) {
        try {
          await AuthClient.passwordLogin(normalizedUsername, password);
        } catch {
          throw new Error('User already exists. Enter correct password to log in.');
        }
      }

      const profile: MultiPoseFaceProfile = {
        poses: {
          front: poseEmbeddings.front!,
          left: poseEmbeddings.left!,
          right: poseEmbeddings.right!,
          up: poseEmbeddings.up!,
          down: poseEmbeddings.down!,
        },
        capturedAt: new Date().toISOString(),
      };

      const frontTemplate = profile.poses.front;

      if (!serverHasUser) {
        await AuthClient.registerUser(normalizedUsername, password, normalizedUsername);
      }

      await AuthClient.enrollDevice(normalizedUsername, deviceId, deviceName, bindingKeyId, frontTemplate.vector);
      await BiometricStore.saveTemplate(frontTemplate);
      await BiometricStore.saveTemplateProfile(profile);
      await BiometricStore.saveDeviceBinding({
        deviceId,
        deviceName,
        bindingKeyId,
        username: normalizedUsername,
      });

      Alert.alert('Enrollment complete', '5-pose face profile and device binding were stored on this device.');
    } catch (error) {
      Alert.alert('Enrollment failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      enrollInFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* ── Header ──────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerIconWrap}>
          <Text style={styles.headerIcon}>◈</Text>
        </View>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Bind your face to this device with zero-knowledge biometrics</Text>
      </View>

      {/* ── Step pills ──────────────────────────────────── */}
      <View style={styles.stepsRow}>
        {['Scan', 'Identity', 'Secure'].map((s, i) => (
          <View key={s} style={styles.stepPill}>
            <View style={[styles.stepNumber, i === 0 && allPosesCaptured && styles.stepNumberDone, i === 1 && username.length > 2 && styles.stepNumberDone]}>
              <Text style={styles.stepNumberText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepLabel}>{s}</Text>
          </View>
        ))}
      </View>

      <View style={styles.poseGuideCard}>
        <Text style={styles.poseGuideLabel}>Current pose</Text>
        <Text style={styles.poseGuideTitle}>{currentPose ? currentPose.label.toUpperCase() : 'DONE'}</Text>
        <Text style={styles.poseGuideHint}>{currentPose ? currentPose.instruction : 'All poses captured'}</Text>
        <Text style={styles.poseGuideProgress}>
          {Object.keys(poseEmbeddings).length} / {POSE_FLOW.length} captured
        </Text>
      </View>

      {/* ── Camera ──────────────────────────────────────── */}
      <CameraCapture label="Biometric scan" onCaptureSample={onPoseCaptured} disabled={busy || allPosesCaptured} actionsMode="full" />

      {/* ── Sample status ───────────────────────────────── */}
      <View style={[styles.sampleStatus, allPosesCaptured && styles.sampleStatusReady]}>
        <View style={[styles.sampleDot, allPosesCaptured && styles.sampleDotReady]} />
        <Text style={[styles.sampleStatusText, allPosesCaptured && styles.sampleStatusTextReady]}>
          {captureStatus}
        </Text>
      </View>

      {/* ── Inputs ──────────────────────────────────────── */}
      <Text style={styles.sectionLabel}>IDENTITY</Text>
      <CyberInput label="Username" value={username} onChangeText={setUsername} />
      <CyberInput label="Fallback PIN / Password" value={password} onChangeText={setPassword} secureTextEntry />
      <CyberInput label="Device name" value={deviceName} onChangeText={setDeviceName} />

      {/* ── Enroll button ───────────────────────────────── */}
      <Pressable style={[styles.enrollButton, busy && styles.buttonDisabled]} onPress={onEnroll} disabled={busy}>
        <Text style={styles.enrollButtonText}>{busy ? 'Enrolling…' : 'Enroll Face Login'}</Text>
      </Pressable>

      {/* ── Back link ───────────────────────────────────── */}
      {onGoLogin ? (
        <Pressable style={styles.backButton} onPress={onGoLogin}>
          <Text style={styles.backButtonText}>← Already have an account?  Login</Text>
        </Pressable>
      ) : null}

      {/* ── Security notice ─────────────────────────────── */}
      <View style={styles.securityNotice}>
        <Text style={styles.securityNoticeTitle}>Privacy first</Text>
        <Text style={styles.securityNoticeCopy}>
          Your face template never leaves this device. Server-side analysis uses only cryptographic embeddings — no raw images are stored.
        </Text>
      </View>
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
  // ── Header ────────────────────────────────────────────────
  header: {
    alignItems: 'center',
    marginBottom: 22,
  },
  headerIconWrap: {
    width: 68,
    height: 68,
    borderRadius: cyberTheme.radius.lg,
    backgroundColor: '#0A0E1A',
    borderWidth: 1.5,
    borderColor: '#7B5CF044',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#7B5CF0',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 14,
  },
  headerIcon: {
    fontSize: 30,
    color: cyberTheme.colors.accentViolet,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: cyberTheme.colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  // ── Steps ─────────────────────────────────────────────────
  stepsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  stepNumber: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: cyberTheme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberDone: {
    backgroundColor: cyberTheme.colors.accentGreen,
  },
  stepNumberText: {
    color: cyberTheme.colors.textPrimary,
    fontSize: 10,
    fontWeight: '800',
  },
  stepLabel: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  poseGuideCard: {
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderColor: cyberTheme.colors.border,
    borderWidth: 1,
    borderRadius: cyberTheme.radius.md,
    padding: 12,
    marginBottom: 14,
  },
  poseGuideLabel: {
    color: cyberTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  poseGuideTitle: {
    color: cyberTheme.colors.accent,
    fontSize: 18,
    fontWeight: '900',
  },
  poseGuideHint: {
    color: cyberTheme.colors.textSecondary,
    marginTop: 2,
  },
  poseGuideProgress: {
    color: cyberTheme.colors.accentGold,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  // ── Sample status ─────────────────────────────────────────
  sampleStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    padding: 12,
    marginBottom: 20,
  },
  sampleStatusReady: {
    borderColor: cyberTheme.colors.accentGreen,
    backgroundColor: '#22C55E0E',
  },
  sampleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: cyberTheme.colors.textMuted,
  },
  sampleDotReady: {
    backgroundColor: cyberTheme.colors.accentGreen,
    shadowColor: cyberTheme.colors.accentGreen,
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  sampleStatusText: {
    color: cyberTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  sampleStatusTextReady: {
    color: cyberTheme.colors.accentGreen,
    fontWeight: '700',
  },
  // ── Section label ─────────────────────────────────────────
  sectionLabel: {
    color: cyberTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
    marginTop: 2,
  },
  // ── Inputs (CyberInput renders these) ─────────────────────
  inputWrap: {
    borderWidth: 1,
    borderColor: cyberTheme.colors.border,
    borderRadius: cyberTheme.radius.md,
    paddingHorizontal: 14,
    paddingTop: 22,
    paddingBottom: 8,
    marginBottom: 12,
    backgroundColor: cyberTheme.colors.surfaceHigh,
  },
  inputWrapFocused: {
    borderColor: cyberTheme.colors.accentViolet,
    shadowColor: cyberTheme.colors.accentViolet,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 0},
    elevation: 10,
  },
  inputLabel: {
    position: 'absolute',
    left: 14,
    top: 6,
    color: cyberTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  inputLabelActive: {
    color: cyberTheme.colors.accentViolet,
  },
  input: {
    color: cyberTheme.colors.textPrimary,
    paddingTop: 4,
    paddingBottom: 2,
    fontSize: 15,
  },
  // ── Enroll button ─────────────────────────────────────────
  enrollButton: {
    backgroundColor: cyberTheme.colors.accentViolet,
    borderRadius: cyberTheme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
    shadowColor: '#7B5CF0',
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: {width: 0, height: 0},
    elevation: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  enrollButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  // ── Back ──────────────────────────────────────────────────
  backButton: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 20,
  },
  backButtonText: {
    color: cyberTheme.colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  // ── Security notice ───────────────────────────────────────
  securityNotice: {
    padding: 16,
    backgroundColor: cyberTheme.colors.surfaceHigh,
    borderRadius: cyberTheme.radius.md,
    borderWidth: 1,
    borderColor: '#F7B73122',
  },
  securityNoticeTitle: {
    fontWeight: '800',
    color: cyberTheme.colors.accentGold,
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  securityNoticeCopy: {
    color: cyberTheme.colors.textSecondary,
    lineHeight: 20,
    fontSize: 13,
  },
});

export default EnrollmentScreen;
