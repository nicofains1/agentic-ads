export interface SearchQuery {
  query?: string;
  keywords?: string[];
  category?: string;
  geo?: string;
  language?: string;
}

export interface AdCandidate {
  id: string;
  campaign_id: string;
  creative_text: string;
  link_url: string;
  keywords: string[];
  categories: string[];
  geo: string;
  language: string;
  quality_score: number;
  bid_amount: number;
  advertiser_name: string;
}

export interface MatchResult {
  ad: AdCandidate;
  relevance_score: number;
  match_details: {
    exact_keyword_matches: string[];
    partial_keyword_matches: string[];
    category_match: boolean;
    geo_match: boolean;
    language_match: boolean;
  };
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "it", "of", "in", "to", "for", "on", "with",
  "at", "by", "from", "this", "that", "and", "or", "but", "not", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "could", "should", "may", "might", "can",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they",
  "what", "which", "who", "where", "when", "how", "why",
  "want", "need", "looking", "find", "get", "buy", "best", "good",
  "un", "una", "el", "la", "los", "las", "de", "en", "por", "para",
  "con", "que", "es", "son", "del", "al", "como", "más", "muy",
  "quiero", "necesito", "busco", "comprar", "mejor", "bueno",
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

export function matchAds(query: SearchQuery, ads: AdCandidate[]): MatchResult[] {
  const queryKeywords: string[] = [];

  if (query.keywords) {
    queryKeywords.push(...query.keywords.map(normalize));
  }
  if (query.query) {
    queryKeywords.push(...extractKeywords(query.query));
  }

  if (queryKeywords.length === 0 && !query.category) {
    return [];
  }

  // Deduplicate
  const uniqueKeywords = [...new Set(queryKeywords)];

  const results: MatchResult[] = [];

  for (const ad of ads) {
    const adKeywords = ad.keywords.map(normalize);
    const adCategories = ad.categories.map(normalize);

    const exact_keyword_matches: string[] = [];
    const partial_keyword_matches: string[] = [];

    for (const qk of uniqueKeywords) {
      for (const ak of adKeywords) {
        if (qk === ak) {
          if (!exact_keyword_matches.includes(ak)) {
            exact_keyword_matches.push(ak);
          }
        } else if (ak.includes(qk) || qk.includes(ak)) {
          if (!partial_keyword_matches.includes(ak)) {
            partial_keyword_matches.push(ak);
          }
        }
      }
    }

    const category_match = query.category
      ? adCategories.includes(normalize(query.category))
      : false;

    const geo_match =
      !query.geo || ad.geo === "ALL" || normalize(ad.geo) === normalize(query.geo);

    const language_match =
      !query.language || normalize(ad.language) === normalize(query.language);

    // Calculate relevance score
    let score = 0;
    score += exact_keyword_matches.length * 0.3;
    score += partial_keyword_matches.length * 0.15;
    if (category_match) score += 0.2;
    if (geo_match) score += 0.1;
    if (language_match) score += 0.05;

    // Normalize to max 1.0
    score = Math.min(score, 1.0);

    // Only include if there's some relevance
    if (score > 0.05) {
      results.push({
        ad,
        relevance_score: Math.round(score * 100) / 100,
        match_details: {
          exact_keyword_matches,
          partial_keyword_matches,
          category_match,
          geo_match,
          language_match,
        },
      });
    }
  }

  return results;
}
