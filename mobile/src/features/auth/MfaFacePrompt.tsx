import React, {useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text} from 'react-native';

import CameraCapture from '../face/CameraCapture';
import {AuthClient} from './AuthClient';
import {BiometricStore} from '../../security/BiometricStore';
import {EmbeddingEngine} from '../face/EmbeddingEngine';
import {FaceCaptureSample, LivenessChecks} from '../face/LivenessChecks';
import {MatchService} from '../face/MatchService';
import {cyberTheme} from '../../theme/cyberTheme';

function buildAssertion(challengeId: string, nonce: string, bindingKeyId: string): string {
  let hash = 0;
  const value = `${challengeId}:${nonce}:${bindingKeyId}`;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

type MfaFacePromptProps = {
  onGoLogin?: () => void;
  onLoginSuccess?: (username: string) => void;
};

function MfaFacePrompt({onGoLogin, onLoginSuccess}: MfaFacePromptProps) {
  const [busy, setBusy] = useState(false);
  const [captureSample, setCaptureSample] = useState<FaceCaptureSample | null>(null);

  const onVerify = async () => {
    setBusy(true);
    try {
      if (!captureSample) {
        throw new Error('Capture a live face sample before MFA verification');
      }

      const binding = await BiometricStore.getDeviceBinding();
      const enrolledTemplate = await BiometricStore.getTemplate();
      if (!binding || !enrolledTemplate) {
        Alert.alert('Not enrolled', 'Enroll face login before using MFA.');
        return;
      }
      if (!captureSample.imageBase64) {
        throw new Error('Image capture failed. Please retake the face photo.');
      }

      const analysis = await AuthClient.analyzeFace(captureSample.imageBase64);
      if (!analysis.face_detected) {
        throw new Error(analysis.message);
      }

      const challenge = await AuthClient.createChallenge(binding.username, binding.deviceId, 'face-mfa');
      const candidateTemplate = EmbeddingEngine.fromAnalysis(analysis.vector, analysis.template_hash);
      const match = MatchService.compare(candidateTemplate, enrolledTemplate);
      const liveness = LivenessChecks.evaluate(captureSample);

      if (!match.matched) {
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

      Alert.alert('MFA complete', `Authenticated as ${session.username} via ${session.auth_method}.`);
      onLoginSuccess?.(session.username);
    } catch (error) {
      Alert.alert('MFA failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>MFA Face Check</Text>
      <Text style={styles.copy}>Secondary biometric verification for sensitive actions.</Text>

      <CameraCapture label="MFA face check" onCaptureSample={setCaptureSample} disabled={busy} />
      <Text style={styles.meta}>{captureSample ? `Secure sample ready • ${captureSample.captureId}` : 'Capture a live sample before MFA verification.'}</Text>
      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={onVerify} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Verifying...' : 'Verify Face MFA'}</Text>
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
    fontSize: 30,
    fontWeight: '800',
    color: cyberTheme.colors.textPrimary,
    marginBottom: 8,
  },
  copy: {
    color: cyberTheme.colors.textSecondary,
    lineHeight: 20,
    marginBottom: 14,
  },
  meta: {
    color: cyberTheme.colors.accent,
    fontWeight: '600',
    marginBottom: 16,
  },
  button: {
    backgroundColor: cyberTheme.colors.accent,
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    ...cyberTheme.shadow.glow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#05170A',
    fontWeight: '700',
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

export default MfaFacePrompt;
