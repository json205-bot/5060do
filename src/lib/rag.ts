import knowledgeData from "@/data/center_knowledge.json";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  buildEmbeddingSpace,
  cosineSimilarity,
  documentSpaceText,
  embedDocument,
  embedText,
  parseVector,
  type EmbeddingSpace,
} from "./embedding";
import { getSupabaseClient } from "./supabase";

type KnowledgeEntry = {
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

const DEFAULT_TOP_K = 3;
// Scores below this are noise from shared vocabulary, not a usable answer.
const DEFAULT_MIN_SCORE = 0.1;

const entries = knowledgeData as KnowledgeEntry[];

let localIndex: RagDocument[] | null = null;
let localSpace: EmbeddingSpace | null = null;
let remoteIndex: Promise<RagDocument[]> | null = null;

function knowledgeContent(entry: KnowledgeEntry): string {
  return (entry.chunks ?? [])
    .filter((chunk) => typeof chunk === "string" && chunk.trim().length > 0)
    .map((chunk) => chunk.trim())
    .join("\n\n");
}

type BaseDocument = {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string;
};

function localBaseDocuments(): BaseDocument[] {
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

function getLocalSpace(): EmbeddingSpace {
  if (!localSpace) {
    localSpace = buildEmbeddingSpace(
      localBaseDocuments().map((document) =>
        documentSpaceText({
          title: document.title,
          category: document.category,
          content: document.content,
        }),
      ),
    );
  }
  return localSpace;
}

export function getLocalRagIndex(): RagDocument[] {
  if (localIndex) return localIndex;

  const space = getLocalSpace();
  localIndex = localBaseDocuments().map((document) => ({
    ...document,
    embedding: embedDocument(
      {
        title: document.title,
        category: document.category,
        content: document.content,
      },
      space,
    ),
  }));

  return localIndex;
}

export function searchKnowledgeRAG(
  query: string,
  options: RagSearchOptions = {},
): RagMatch[] {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const index = options.index ?? getLocalRagIndex();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const queryVector = embedText(normalized, getLocalSpace());

  return index
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
}

type RemoteDocumentRow = {
  id: number;
  title: string;
  category: string | null;
  content: string | null;
  embedding: unknown;
};

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

  const space = getLocalSpace();
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
