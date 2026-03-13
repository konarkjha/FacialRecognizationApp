export type FaceEmbedding = {
  vector: number[];
  templateHash: string;
  capturedAt: string;
};

function pseudoHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `emb-${hash.toString(16)}`;
}

export const EmbeddingEngine = {
  fromAnalysis(vector: number[], templateHash: string): FaceEmbedding {
    return {
      vector,
      templateHash: templateHash || pseudoHash(JSON.stringify(vector)),
      capturedAt: new Date().toISOString(),
    };
  },
};
