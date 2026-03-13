import {API_BASE_URL} from '../../runtime/config';

export type ChallengeResponse = {
  challenge_id: string;
  nonce: string;
  expires_at: string;
  mode: 'face-primary' | 'face-mfa';
  message: string;
};

export type SessionResponse = {
  access_token: string;
  expires_at: string;
  username: string;
  auth_method: string;
};

export type EnrollmentStatusResponse = {
  username: string;
  face_enrolled: boolean;
  devices: string[];
};

export type FaceAnalyzeResponse = {
  vector: number[];
  template_hash: string;
  face_detected: boolean;
  confidence: number;
  message: string;
  liveness_score: number;
  is_live: boolean;
};

export type MotionCheckResponse = {
  motion_detected: boolean;
  diff_score: number;
  message: string;
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Request failed');
  }

  return response.json() as Promise<T>;
}

export const AuthClient = {
  registerUser: (username: string, password: string, displayName?: string) =>
    request<{message: string}>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({username, password, display_name: displayName}),
    }),

  enrollDevice: (
    username: string,
    deviceId: string,
    deviceName: string,
    bindingKeyId: string,
    faceVector?: number[],
    faceVectors?: Record<string, number[]>,
  ) =>
    request<{message: string}>('/auth/enroll-device', {
      method: 'POST',
      body: JSON.stringify({
        username,
        device_id: deviceId,
        device_name: deviceName,
        binding_key_id: bindingKeyId,
        face_vector: faceVector ?? null,
        face_vectors: faceVectors ?? null,
      }),
    }),

  passwordLogin: (username: string, password: string) =>
    request<SessionResponse>('/auth/password-login', {
      method: 'POST',
      body: JSON.stringify({username, password}),
    }),

  getEnrollmentStatus: (username: string) => request<EnrollmentStatusResponse>(`/auth/enrollment/${encodeURIComponent(username)}`),

  analyzeFace: (imageBase64: string) =>
    request<FaceAnalyzeResponse>('/auth/analyze-face', {
      method: 'POST',
      body: JSON.stringify({image_base64: imageBase64}),
    }),

  checkMotion: (frame1Base64: string, frame2Base64: string) =>
    request<MotionCheckResponse>('/auth/check-motion', {
      method: 'POST',
      body: JSON.stringify({frame1_base64: frame1Base64, frame2_base64: frame2Base64}),
    }),

  createChallenge: (username: string, deviceId: string, mode: 'face-primary' | 'face-mfa') =>
    request<ChallengeResponse>('/auth/challenge', {
      method: 'POST',
      body: JSON.stringify({username, device_id: deviceId, mode}),
    }),

  verifyChallenge: (
    challengeId: string,
    username: string,
    deviceId: string,
    faceMatch: boolean,
    livenessScore: number,
    clientAssertion: string,
    fallbackUsed = false,
    candidatePoseVectors?: Record<string, number[]>,
    minimumMatchScore = 70,
  ) =>
    request<SessionResponse>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challengeId,
        username,
        device_id: deviceId,
        face_match: faceMatch,
        liveness_score: livenessScore,
        client_assertion: clientAssertion,
        fallback_used: fallbackUsed,
        candidate_pose_vectors: candidatePoseVectors ?? null,
        minimum_match_score: minimumMatchScore,
      }),
    }),
};
