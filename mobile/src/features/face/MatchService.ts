import {FaceEmbedding} from './EmbeddingEngine';

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
      matched: similarity >= 0.45 && distance <= 0.09,
      similarity,
    };
  },
};
