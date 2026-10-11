import type { Chunk } from '../../../types';
/** The stored index: its chunks, the model it was embedded with, its size, a full replace. */
export type ChunkStore = {
  all(): Chunk[];
  indexModel(): string | undefined;
  count(): { chunks: number };
  replace(chunks: Chunk[], settings: { model: string; dimensions: number }): void;
};
