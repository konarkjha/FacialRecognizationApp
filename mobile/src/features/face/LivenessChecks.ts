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
};

export type LivenessResult = {
  passed: boolean;
  score: number;
  reasons: string[];
};

export const LivenessChecks = {
  evaluate(sample: FaceCaptureSample): LivenessResult {
    let score = 0.35;
    const reasons: string[] = [];

    if (sample.faceCentered) {
      score += 0.2;
    } else {
      reasons.push('Face is not centered');
    }

    if (sample.eyesOpen) {
      score += 0.1;
    } else {
      reasons.push('Eyes not visible');
    }

    if (sample.blinkDetected) {
      score += 0.2;
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

    const normalized = Math.min(1, Number(score.toFixed(2)));
    return {
      passed: normalized >= 0.7,
      score: normalized,
      reasons,
    };
  },
};