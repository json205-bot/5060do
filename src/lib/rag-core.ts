import {
  EMBEDDING_DIM,
  buildEmbeddingSpace,
  cosineSimilarity,
  documentSpaceText,
  embedDocument,
  embedText,
  toVectorLiteral,
  type EmbeddingSpace,
} from "./embedding.ts";

export type KnowledgeEntry = {
  id: string;
  category?: string;
  title?: string;
  sourceUrl?: string;
  chunks?: string[];
};

export type RagDocument = {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string;
  embedding: number[];
};

export type RagMatch = Omit<RagDocument, "embedding"> & {
  score: number;
};

export type RagSearchOptions = {
  topK?: number;
  minScore?: number;
  index?: RagDocument[];
};

type BaseDocument = {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string;
};

const DEFAULT_TOP_K = 3;
// Scores below this are noise from shared vocabulary, not a usable answer.
const DEFAULT_MIN_SCORE = 0.1;
const DEFAULT_RPC_TIMEOUT_MS = 2500;

export const defaultRagRpcTimeoutMs = DEFAULT_RPC_TIMEOUT_MS;

export type RagRpcArgs = {
  query_embedding: string;
  match_count: number;
  min_similarity: number;
};

export type RagRpcResult = {
  data?: unknown;
  error?: { message?: string } | null;
};

export type RagRpcCall = (args: RagRpcArgs) => Promise<RagRpcResult>;

export type RagSearchOutcome = {
  matches: RagMatch[];
  source: "rpc" | "bundle";
  reason: string;
  rpcRows: number;
};

type RagRpcRow = {
  id: number | string;
  title?: string | null;
  category?: string | null;
  content?: string | null;
  similarity?: number | null;
};

function knowledgeContent(entry: KnowledgeEntry): string {
  return (entry.chunks ?? [])
    .filter((chunk) => typeof chunk === "string" && chunk.trim().length > 0)
    .map((chunk) => chunk.trim())
    .join("\n\n");
}

function localBaseDocuments(entries: KnowledgeEntry[]): BaseDocument[] {
  const documents: BaseDocument[] = [];
  for (const entry of entries) {
    const content = knowledgeContent(entry);
    if (!content) continue;
    documents.push({
      id: entry.id,
      title: entry.title ?? entry.id,
      category: entry.category ?? "",
      content,
      sourceUrl: entry.sourceUrl ?? "",
    });
  }
  return documents;
}

function sourceUrlMap(entries: KnowledgeEntry[]): Map<string, string> {
  const urls = new Map<string, string>();
  for (const entry of entries) {
    if (entry.title && entry.sourceUrl) urls.set(entry.title, entry.sourceUrl);
  }
  return urls;
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`RPC timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// The bundled vector index is the always-available path. The RPC path is a
// best-effort upgrade: any failure (missing function, RLS/network error, empty
// result) falls back to this engine instead of surfacing an exception.
export function createRagEngine(entries: KnowledgeEntry[]) {
  const baseDocuments = localBaseDocuments(entries);
  const urls = sourceUrlMap(entries);
  let index: RagDocument[] | null = null;
  let space: EmbeddingSpace | null = null;

  const getSpace = (): EmbeddingSpace => {
    if (!space) {
      space = buildEmbeddingSpace(
        baseDocuments.map((document) =>
          documentSpaceText({
            title: document.title,
            category: document.category,
            content: document.content,
          }),
        ),
      );
    }
    return space;
  };

  const getIndex = (): RagDocument[] => {
    if (index) return index;
    const current = getSpace();
    index = baseDocuments.map((document) => ({
      ...document,
      embedding: embedDocument(
        {
          title: document.title,
          category: document.category,
          content: document.content,
        },
        current,
      ),
    }));
    return index;
  };

  const search = (
    query: string,
    options: RagSearchOptions = {},
  ): RagMatch[] => {
    const normalized = normalizeQuery(query);
    if (!normalized) return [];

    const rows = options.index ?? getIndex();
    const topK = options.topK ?? DEFAULT_TOP_K;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const queryVector = embedText(normalized, getSpace());

    return rows
      .map((document) => ({
        id: document.id,
        title: document.title,
        category: document.category,
        content: document.content,
        sourceUrl: document.sourceUrl,
        score: cosineSimilarity(queryVector, document.embedding),
      }))
      .filter((match) => match.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
  };

  const searchWithRpc = async (
    query: string,
    options: RagSearchOptions,
    call: RagRpcCall,
    config: { timeoutMs?: number } = {},
  ): Promise<RagSearchOutcome> => {
    const normalized = normalizeQuery(query);
    const bundle = (reason: string): RagSearchOutcome => ({
      matches: search(normalized, options),
      source: "bundle",
      reason,
      rpcRows: 0,
    });

    if (!normalized) {
      return { matches: [], source: "bundle", reason: "empty-query", rpcRows: 0 };
    }

    const topK = options.topK ?? DEFAULT_TOP_K;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const timeoutMs = config.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;

    try {
      const queryVector = toVectorLiteral(embedText(normalized, getSpace()));
      const response = await withTimeout(
        call({
          query_embedding: queryVector,
          match_count: topK,
          min_similarity: minScore,
        }),
        timeoutMs,
      );

      if (response?.error) {
        return bundle(`rpc-error: ${response.error.message ?? "unknown"}`);
      }
      if (!Array.isArray(response?.data)) {
        return bundle("rpc-invalid-response");
      }

      const matches = (response.data as RagRpcRow[])
        .map((row) => {
          const content = (row.content ?? "").trim();
          if (!content) return null;
          const title = row.title ?? String(row.id);
          return {
            id: String(row.id),
            title,
            category: row.category ?? "",
            content,
            sourceUrl: urls.get(title) ?? "",
            score: Number(row.similarity ?? 0),
          };
        })
        .filter((match): match is RagMatch => Boolean(match))
        .filter((match) => match.score >= minScore)
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);

      if (matches.length === 0) {
        return bundle("rpc-empty");
      }

      return {
        matches,
        source: "rpc",
        reason: "ok",
        rpcRows: response.data.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return bundle(`rpc-exception: ${message}`);
    }
  };

  return { getIndex, getSpace, search, searchWithRpc };
}

export { EMBEDDING_DIM, DEFAULT_TOP_K, DEFAULT_MIN_SCORE };
