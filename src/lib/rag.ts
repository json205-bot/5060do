import knowledgeData from "@/data/center_knowledge.json";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  parseVector,
  embedDocument,
} from "./embedding";
import {
  createRagEngine,
  defaultRagRpcTimeoutMs,
  type KnowledgeEntry,
  type RagDocument,
  type RagMatch,
  type RagSearchOutcome,
  type RagSearchOptions,
} from "./rag-core";
import { getSupabaseClient } from "./supabase";

export type { RagDocument, RagMatch, RagSearchOutcome, RagSearchOptions };

const entries = knowledgeData as KnowledgeEntry[];
const engine = createRagEngine(entries);

let remoteIndex: Promise<RagDocument[]> | null = null;

export function getLocalRagIndex(): RagDocument[] {
  return engine.getIndex();
}

export function searchKnowledgeRAG(
  query: string,
  options: RagSearchOptions = {},
): RagMatch[] {
  return engine.search(query, options);
}

// RPC is an optional upgrade over the bundled vectors. The returned matches are
// identical in shape, so a missing function or a blocked network never breaks
// the chatbot: the guard falls back to searchKnowledgeRAG() and only the reason
// changes.
export async function searchKnowledgeRAGRemote(
  query: string,
  options: RagSearchOptions = {},
  config: { timeoutMs?: number } = {},
): Promise<RagSearchOutcome> {
  const client = getSupabaseClient();
  return engine.searchWithRpc(
    query,
    options,
    async (args) => {
      if (!client) {
        return { data: null, error: { message: "supabase client is not configured" } };
      }
      return client.rpc("match_documents", args);
    },
    { timeoutMs: config.timeoutMs ?? defaultRagRpcTimeoutMs },
  );
}

// Opt-in remote path: the static export reads bundled vectors by default so a
// blocked or slow network can never break the chatbot. Set
// NEXT_PUBLIC_RAG_SOURCE=supabase to source the vectors stored by
// scripts/seed-embeddings.mjs instead.
export async function loadRagIndex(): Promise<RagDocument[]> {
  if (process.env.NEXT_PUBLIC_RAG_SOURCE !== "supabase") {
    return getLocalRagIndex();
  }
  if (!remoteIndex) {
    remoteIndex = fetchRemoteIndex().catch(() => getLocalRagIndex());
  }
  return remoteIndex;
}

type RemoteDocumentRow = {
  id: number;
  title: string;
  category: string | null;
  content: string | null;
  embedding: unknown;
};

async function fetchRemoteIndex(): Promise<RagDocument[]> {
  const client = getSupabaseClient();
  if (!client) return getLocalRagIndex();

  const { data, error } = await client
    .from("documents")
    .select("id,title,category,content,embedding")
    .not("embedding", "is", null)
    .order("id", { ascending: true })
    .limit(50);

  if (error || !Array.isArray(data) || data.length === 0) {
    return getLocalRagIndex();
  }

  const urls = new Map<string, string>();
  for (const entry of entries) {
    if (entry.title && entry.sourceUrl) urls.set(entry.title, entry.sourceUrl);
  }

  const space = engine.getSpace();
  const documents: RagDocument[] = [];

  for (const raw of data as RemoteDocumentRow[]) {
    const content = (raw.content ?? "").trim();
    if (!content) continue;
    const title = raw.title ?? String(raw.id);
    const embedding = parseVector(raw.embedding);
    documents.push({
      id: String(raw.id),
      title,
      category: raw.category ?? "",
      content,
      sourceUrl: urls.get(title) ?? "",
      embedding:
        embedding && embedding.length === EMBEDDING_DIM
          ? embedding
          : embedDocument({ title, category: raw.category ?? "", content }, space),
    });
  }

  return documents.length > 0 ? documents : getLocalRagIndex();
}

export { EMBEDDING_DIM, EMBEDDING_MODEL };
