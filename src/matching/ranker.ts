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

// Relevance is the primary signal. Bid is secondary (tiebreaker).
// Formula: relevance^2 * bidFactor * quality
// Squaring relevance ensures highly relevant ads beat high-bid irrelevant ones.
const RELEVANCE_EXPONENT = 2;
const BID_WEIGHT = 0.3; // Bid contributes at most 30% to final score

export function rankAds(matches: MatchResult[], maxResults: number = 3): RankedAd[] {
  if (matches.length === 0) return [];

  const maxBid = Math.max(...matches.map((m) => m.ad.bid_amount));

  const scored = matches
    .filter((m) => m.relevance_score >= MIN_RELEVANCE_THRESHOLD)
    .map((m) => {
      const normalizedBid = maxBid > 0 ? m.ad.bid_amount / maxBid : 1;
      // Weighted bid factor: ranges from (1 - BID_WEIGHT) to 1.0
      const bidFactor = (1 - BID_WEIGHT) + (BID_WEIGHT * normalizedBid);
      const finalScore =
        Math.pow(m.relevance_score, RELEVANCE_EXPONENT) * bidFactor * m.ad.quality_score;
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
