import React, {useRef, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {AuthClient} from './AuthClient';
import CameraCapture from '../face/CameraCapture';
import {EmbeddingEngine} from '../face/EmbeddingEngine';
import {FaceCaptureSample, LivenessChecks} from '../face/LivenessChecks';
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
  const [captureSample, setCaptureSample] = useState<FaceCaptureSample | null>(null);
  const enrollInFlightRef = useRef(false);

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

      if (!captureSample) {
        throw new Error('Capture a live face sample before enrollment');
      }

      const liveness = LivenessChecks.evaluate(captureSample);
      if (!liveness.passed) {
        throw new Error(`Liveness check failed: ${liveness.reasons.join(', ')}`);
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
      const localTemplate = await BiometricStore.getTemplate();
      const localAlreadyEnrolled =
        localBinding?.username === normalizedUsername && localBinding?.deviceId === deviceId && Boolean(localTemplate);

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

      if (!captureSample.imageBase64) {
        throw new Error('Image capture failed. Please retake the face photo.');
      }

      const analysis = await AuthClient.analyzeFace(captureSample.imageBase64);
      if (!analysis.face_detected) {
        throw new Error(analysis.message);
      }
      const template = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);

      if (!serverHasUser) {
        await AuthClient.registerUser(normalizedUsername, password, normalizedUsername);
      }

      await AuthClient.enrollDevice(normalizedUsername, deviceId, deviceName, bindingKeyId, analysis.vector);
      await BiometricStore.saveTemplate(template);
      await BiometricStore.saveDeviceBinding({
        deviceId,
        deviceName,
        bindingKeyId,
        username: normalizedUsername,
      });

      Alert.alert('Enrollment complete', 'Face template and device binding were stored on this device.');
    } catch (error) {
      Alert.alert('Enrollment failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      enrollInFlightRef.current = false;
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Enroll Face</Text>
      <Text style={styles.subtitle}>Bind this device to your biometric profile with secure on-device templates.</Text>

      <CameraCapture label="Enrollment capture" onCaptureSample={setCaptureSample} disabled={busy} />
      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Capture status</Text>
        <Text style={styles.noteCopy}>{captureSample ? `Sample ready at ${captureSample.capturedAt}` : 'No live sample captured yet.'}</Text>
      </View>

      <CyberInput label="Username" value={username} onChangeText={setUsername} />
      <CyberInput label="Fallback PIN / Password" value={password} onChangeText={setPassword} secureTextEntry />
      <CyberInput label="Device name" value={deviceName} onChangeText={setDeviceName} />

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={onEnroll} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Enrolling...' : 'Enroll Face Login'}</Text>
      </Pressable>

      {onGoLogin ? (
        <Pressable style={styles.linkButton} onPress={onGoLogin}>
          <Text style={styles.linkText}>Back to login</Text>
        </Pressable>
      ) : null}

      <View style={styles.noteBox}>
        <Text style={styles.noteTitle}>Security note</Text>
        <Text style={styles.noteCopy}>
          Face templates stay local to this device and are matched with server-assisted analysis only for authentication.
        </Text>
      </View>
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
    marginBottom: 16,
  },
  inputWrap: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 6,
    marginBottom: 14,
    backgroundColor: cyberTheme.colors.surfaceSoft,
  },
  inputWrapFocused: {
    borderColor: cyberTheme.colors.accent,
    ...cyberTheme.shadow.glow,
  },
  inputLabel: {
    position: 'absolute',
    left: 14,
    top: 5,
    color: cyberTheme.colors.textMuted,
    fontSize: 11,
  },
  inputLabelActive: {
    color: cyberTheme.colors.accent,
  },
  input: {
    color: cyberTheme.colors.textPrimary,
    paddingTop: 12,
    paddingBottom: 6,
  },
  button: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 8,
    ...cyberTheme.shadow.glow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#041a08',
    fontWeight: '700',
  },
  noteBox: {
    marginTop: 12,
    padding: 14,
    backgroundColor: cyberTheme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1d2b1a',
  },
  noteTitle: {
    fontWeight: '700',
    color: cyberTheme.colors.accent,
    marginBottom: 6,
  },
  noteCopy: {
    color: cyberTheme.colors.textSecondary,
    lineHeight: 20,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 14,
  },
  linkText: {
    color: '#98ff8d',
    fontWeight: '700',
  },
});

export default EnrollmentScreen;
