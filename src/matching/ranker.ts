import type { MatchResult } from "./keyword-matcher.js";

export interface RankedAd {
  ad_id: string;
  advertiser_name: string;
  creative_text: string;
  link_url: string;
  relevance_score: number;
  disclosure: "sponsored";
}

const MIN_RELEVANCE_THRESHOLD = 0.1;

export function rankAds(matches: MatchResult[], maxResults: number = 3): RankedAd[] {
  if (matches.length === 0) return [];

  const maxBid = Math.max(...matches.map((m) => m.ad.bid_amount));

  const scored = matches
    .filter((m) => m.relevance_score >= MIN_RELEVANCE_THRESHOLD)
    .map((m) => {
      const normalizedBid = maxBid > 0 ? m.ad.bid_amount / maxBid : 1;
      const finalScore =
        m.relevance_score * normalizedBid * m.ad.quality_score;
      return { match: m, score: finalScore };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return scored.map(({ match }) => ({
    ad_id: match.ad.id,
    advertiser_name: match.ad.advertiser_name,
    creative_text: match.ad.creative_text,
    link_url: match.ad.link_url,
    relevance_score: match.relevance_score,
    disclosure: "sponsored" as const,
  }));
}
