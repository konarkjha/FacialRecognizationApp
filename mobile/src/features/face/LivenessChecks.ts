export type FaceCaptureSample = {
  captureId: string;
  capturedAt: string;
  imageBase64: string;
  featureSource: string;
  width: number;
  height: number;
  fileSize: number;
  faceCentered: boolean;
  eyesOpen: boolean;
  blinkDetected: boolean;
  headTurnDetected: boolean;
  brightness: number;
  /** True when the two liveness-challenge frames differed (motion detected) */
  livenessMotionDetected: boolean;
  /** Challenge instruction shown to the user, e.g. 'BLINK', 'SMILE', 'NONE' */
  challengeType: string;
};

export type LivenessResult = {
  passed: boolean;
  score: number;
  reasons: string[];
};

export const LivenessChecks = {
  evaluate(sample: FaceCaptureSample): LivenessResult {
    let score = 0.25;
    const reasons: string[] = [];

    if (sample.faceCentered) {
      score += 0.15;
    } else {
      reasons.push('Face is not centered');
    }

    if (sample.eyesOpen) {
      score += 0.1;
    } else {
      reasons.push('Eyes not visible');
    }

    if (sample.blinkDetected) {
      score += 0.1;
    } else {
      reasons.push('Blink not detected');
    }

    if (sample.headTurnDetected) {
      score += 0.1;
    } else {
      reasons.push('Head movement not detected');
    }

    if (sample.brightness >= 0.45) {
      score += 0.1;
    } else {
      reasons.push('Lighting too low');
    }

    // Motion between two frames is the strongest liveness signal
    if (sample.livenessMotionDetected) {
      score += 0.2;
    } else if (sample.challengeType !== 'NONE') {
      // Challenge was run but no motion → likely a static photo/screen
      score -= 0.2;
      reasons.push('No face movement detected — possible photo spoof');
    }

    const normalized = Math.min(1, Math.max(0, Number(score.toFixed(2))));
    return {
      passed: normalized >= 0.55,
      score: normalized,
      reasons,
    };
  },
};