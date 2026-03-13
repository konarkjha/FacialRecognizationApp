import {FaceEmbedding, MultiPoseFaceProfile, PoseKey} from './EmbeddingEngine';

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));

  if (!magnitudeA || !magnitudeB) {
    return 0;
  }

  return dot / (magnitudeA * magnitudeB);
}

function meanAbsoluteDistance(a: number[], b: number[]): number {
  if (!a.length || !b.length) {
    return 1;
  }
  const pairs = Math.min(a.length, b.length);
  let total = 0;
  for (let index = 0; index < pairs; index += 1) {
    total += Math.abs(a[index] - b[index]);
  }
  return total / pairs;
}

export const MatchService = {
  compare(candidate: FaceEmbedding, enrolled: FaceEmbedding): {matched: boolean; similarity: number} {
    const similarity = cosineSimilarity(candidate.vector, enrolled.vector);
    const distance = meanAbsoluteDistance(candidate.vector, enrolled.vector);
    return {
      matched: similarity >= 0.74 && distance <= 0.065,
      similarity,
    };
  },

  compareMultiPose(candidate: MultiPoseFaceProfile, enrolled: MultiPoseFaceProfile): {matched: boolean; score: number; perPose: Record<PoseKey, number>} {
    const keys: PoseKey[] = ['front', 'left', 'right', 'up', 'down'];
    const perPose = {} as Record<PoseKey, number>;
    let total = 0;

    for (const key of keys) {
      const cand = candidate.poses[key];
      const base = enrolled.poses[key];
      const similarity = cosineSimilarity(cand.vector, base.vector);
      const distance = meanAbsoluteDistance(cand.vector, base.vector);

      const simScore = Math.max(0, Math.min(1, (similarity - 0.50) / 0.40));
      const distPenalty = Math.max(0, Math.min(1, (distance - 0.04) / 0.07));
      const poseScore = Math.max(0, Math.min(1, simScore * (1 - 0.45 * distPenalty)));

      perPose[key] = Number((poseScore * 100).toFixed(1));
      total += poseScore;
    }

    const avg = total / keys.length;
    const percent = Number((avg * 100).toFixed(1));
    return {
      matched: percent >= 70,
      score: percent,
      perPose,
    };
  },
};
