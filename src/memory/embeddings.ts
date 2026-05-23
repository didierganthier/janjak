// ─── Memory: OpenAI embeddings wrapper ─────────────────────────
// Wraps text-embedding-3-small (1536 dims) with batching + simple retry.

import OpenAI from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to ~/.janjak/.env to enable semantic memory."
    );
  }
  client = new OpenAI({ apiKey });
  return client;
}

/** Embed a single string into a 1536-dim Float32Array. */
export async function embed(text: string): Promise<Float32Array> {
  const [vec] = await embedBatch([text]);
  if (!vec) throw new Error("Embedding API returned no result.");
  return vec;
}

/** Embed many strings in a single API call. Order is preserved. */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const cleaned = texts.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) return [];

  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleaned,
  });

  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => Float32Array.from(d.embedding));
}

/** Convert a Float32Array into a Buffer for SQLite BLOB storage. */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Convert a SQLite BLOB back into a Float32Array. */
export function blobToVector(buf: Buffer): Float32Array {
  // Copy to ensure alignment + independent lifetime from the SQLite-owned buffer.
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
}
