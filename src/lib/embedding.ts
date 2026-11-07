// Deterministic 768-dimension text embedding shared by the seed script and the
// browser chatbot. A hosted embedding API would be ideal, but the static export
// has no server to keep a provider key on, so both sides derive the same vector
// from the text itself.
//
// The 768 dimensions are a fixed vocabulary built from the knowledge corpus:
// each selected term owns exactly one dimension, so there are no hash collisions
// and an unknown word (e.g. "헬스장") contributes nothing instead of noise.
// Terms are IDF-weighted, title and category terms are boosted, and Korean
// tokens are stripped of common particles/endings before matching.
export const EMBEDDING_DIM = 768;
export const EMBEDDING_MODEL = "5060do-vocab-768-v4";

// Query words rarely match document wording exactly (e.g. "차를 세워요" vs
// "주차장"). Each group maps surface forms onto one canonical concept token.
// Groups whose wording is already handled by the chatbot's keyword rules
// (전화/위치/무료/신청) or is too generic for retrieval (교육) are left out on
// purpose: they only added noise to the vector scores.
//
// The 일자리·프로그램안내·인생설계·커뮤니티지원 groups follow the questions
// middle-aged job seekers actually type (알바·시니어클럽·자격증·배움터·동아리방)
// so the same concept reaches the document even when no word overlaps.
const SYNONYM_GROUPS: Record<string, string[]> = {
  주차: ["주차", "주차장", "주차하", "세워", "차를 대", "차량"],
  위치: ["위치", "주소", "오시는", "찾아오", "찾아가", "약도", "지도", "어디"],
  대관: ["대관", "강당", "대관료", "이용료", "대여", "빌리", "얼마", "장소 대여"],
  시설: ["층별", "몇 층", "층 안내"],
  커뮤니티: ["커뮤니티", "동아리", "소모임", "모임", "사회참여"],
  커뮤니티지원: [
    "커뮤니티지원",
    "동아리방",
    "모임장소",
    "모임 장소",
    "소모임실",
    "커뮤니티실",
  ],
  공유사무실: [
    "공유사무실",
    "공유오피스",
    "사무실",
    "입주",
    "사무공간",
    "회의실",
  ],
  상담: ["상담", "생애설계", "생애", "이모작", "진단", "컨설팅", "코칭", "은퇴"],
  연혁: ["연혁", "역사", "설립", "개소", "개관", "언제 생", "언제 문", "문을 열"],
  조직: ["조직", "부서", "센터장", "담당", "운영진"],
  비전: ["비전", "미션", "핵심가치", "목표", "가치"],
  소개: ["소개", "인사말", "환영"],
  일자리: [
    "일자리",
    "취업",
    "재취업",
    "직업",
    "구인",
    "구직",
    "알바",
    "아르바이트",
    "시니어클럽",
    "사회공헌",
    "jobs",
  ],
  프로그램안내: [
    "프로그램",
    "프로그램안내",
    "교육프로그램",
    "강좌",
    "강의",
    "수강",
    "배움터",
    "자격증",
    "강습",
    "교육신청",
  ],
  인생설계: [
    "인생설계",
    "인생 설계",
    "생애설계",
    "생애 설계",
    "노후설계",
    "은퇴설계",
    "자격증",
    "배움터",
    "수강",
  ],
  교통: ["교통", "지하철", "버스", "정류장"],
  운영시간: ["운영시간", "평일", "점심시간", "몇 시", "영업시간"],
};

const STOP_WORDS = new Set([
  "https", "http", "www", "com", "kr", "co", "or", "the", "and", "for",
]);

// Verbs/adjectives that survive suffix stripping but carry no topic signal.
// Without this list "헬스장 있나요?" scores against every document that contains
// "있습니다".
const GENERIC_STEMS = new Set([
  "있", "없", "하", "되", "같", "않", "수", "것", "등", "및", "때", "중",
  "위", "더", "잘", "안", "못", "이", "그", "저", "분", "명", "년", "월",
]);

// Longest first so "에서" wins over "서" and "입니다" over "다".
const KOREAN_SUFFIXES = [
  "으로서", "으로써", "에서는", "에게서", "이라고", "하세요", "했습니다", "합니다",
  "입니다", "습니다", "인가요", "을까요", "할게요", "했어요", "이에요", "예요",
  "에서", "에게", "으로", "까지", "부터", "보다", "처럼", "마다", "조차", "이랑",
  "이나", "거나", "하며", "이고", "해요", "어요", "아요", "나요", "까요", "군요",
  "네요", "다면", "하고",
  "은", "는", "이", "가", "을", "를", "의", "에", "로", "과", "와", "도",
  "만", "며", "고", "서", "요", "랑",
];

type EmbeddableDocument = {
  title: string;
  category?: string;
  content: string;
};

export type EmbeddingSpace = {
  index: Map<string, number>;
  weights: Float64Array;
};

type Feature = {
  key: string;
  weight: number;
};

function stripSuffix(token: string): string {
  for (const suffix of KOREAN_SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    if (stem.length >= 1) return stem;
  }
  return token;
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

// Synonym matching runs on a punctuation/space-free copy so "세워요" still
// contains the surface form "세워".
function compact(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function termFeatures(text: string, scale = 1): Feature[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    // Floor labels are written as "강의실1" while questions say "강의실".
    const stem = stripSuffix(token).replace(/[0-9]+$/, "") || stripSuffix(token);
    counts.set(stem, (counts.get(stem) ?? 0) + 1);
  }
  return [...counts].map(([stem, count]) => ({
    key: `w:${stem}`,
    weight: (1 + Math.log(count)) * scale,
  }));
}

function synonymFeatures(text: string, scale = 1): Feature[] {
  const flat = compact(text);
  const features: Feature[] = [];
  for (const [canonical, forms] of Object.entries(SYNONYM_GROUPS)) {
    if (forms.some((form) => flat.includes(compact(form)))) {
      features.push({ key: `s:${canonical}`, weight: 1.6 * scale });
    }
  }
  return features;
}

function collectFeatures(text: string, scale = 1): Feature[] {
  return [...termFeatures(text, scale), ...synonymFeatures(text, scale)];
}

function documentFeatures(document: EmbeddableDocument): Feature[] {
  // Short fields are boosted in the score rather than duplicated in the text,
  // so the frequency table stays honest. Synonym matches inherit the field
  // boost too, which lets "센터 소개" surface the 인사말 document.
  return [
    ...termFeatures(document.title, 2.4),
    ...termFeatures(document.category ?? "", 1.6),
    ...termFeatures(document.content, 1),
    ...synonymFeatures(document.title, 2.4),
    ...synonymFeatures(document.category ?? "", 1.6),
    ...synonymFeatures(document.content, 1),
  ];
}

function documentText(document: EmbeddableDocument): string {
  return [document.title, document.category ?? "", document.content].join(" ");
}

export function documentSpaceText(document: EmbeddableDocument): string {
  return documentText(document);
}
export function buildEmbeddingSpace(texts: string[]): EmbeddingSpace {
  const documentFrequency = new Map<string, number>();

  for (const text of texts) {
    const keys = new Set(collectFeatures(text).map((feature) => feature.key));
    for (const key of keys) {
      documentFrequency.set(key, (documentFrequency.get(key) ?? 0) + 1);
    }
  }

  const total = Math.max(texts.length, 1);
  const ranked = [...documentFrequency]
    .map(([key, count]) => ({
      key,
      idf: Math.log((total + 1) / (count + 1)) + 1,
    }))
    // Drop terms that appear in most documents ("센터", "있습니다") and generic
    // verbs; they carry no retrieval signal. Then prefer the most discriminative
    // terms. The key tie-break keeps the vocabulary stable across runs.
    .filter((entry) => entry.idf >= 1.3)
    .filter((entry) => !(entry.key.startsWith("w:") && GENERIC_STEMS.has(entry.key.slice(2))))
    .sort((left, right) => right.idf - left.idf || (left.key < right.key ? -1 : 1))
    .slice(0, EMBEDDING_DIM);

  const index = new Map<string, number>();
  const weights = new Float64Array(ranked.length);
  ranked.forEach((entry, position) => {
    index.set(entry.key, position);
    weights[position] = entry.idf;
  });

  return { index, weights };
}

function normalize(vector: Float64Array): number[] {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) {
    sum += vector[index] * vector[index];
  }
  const length = Math.sqrt(sum);
  const result = new Array<number>(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    result[index] = length > 0 ? vector[index] / length : 0;
  }
  return result;
}

function project(features: Feature[], space: EmbeddingSpace): number[] {
  const vector = new Float64Array(EMBEDDING_DIM);

  for (const feature of features) {
    const position = space.index.get(feature.key);
    if (position === undefined) continue;
    vector[position] += feature.weight * space.weights[position];
  }

  return normalize(vector);
}

export function embedText(text: string, space: EmbeddingSpace): number[] {
  return project(collectFeatures(text), space);
}

export function embedDocument(
  document: EmbeddableDocument,
  space: EmbeddingSpace,
): number[] {
  return project(documentFeatures(document), space);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  for (let index = 0; index < size; index += 1) {
    dot += left[index] * right[index];
  }
  return dot;
}

// PostgREST returns pgvector values as "[0.1,0.2,...]" strings, but a plain
// array or a JSON string can also show up depending on the client version.
export function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const vector = value.map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    const vector = trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => Number(item));
    return vector.every((item) => Number.isFinite(item)) ? vector : null;
  }
  return null;
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(",")}]`;
}
