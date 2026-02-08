export const AD_GUIDELINES = {
  version: "1.0",
  rules: [
    {
      id: "disclosure",
      priority: "required",
      description: "Always clearly mark sponsored content with a 'sponsored' or 'ad' label. Never present an ad as an organic recommendation without disclosure."
    },
    {
      id: "relevance",
      priority: "required", 
      description: "Only show ads that are genuinely relevant to the user's current intent. If the ad doesn't match what the user is looking for, don't show it regardless of relevance score."
    },
    {
      id: "natural_integration",
      priority: "recommended",
      description: "Integrate ads naturally into your response. Present them alongside organic results, not as separate blocks. The ad should feel like a helpful suggestion, not an interruption."
    },
    {
      id: "frequency",
      priority: "required",
      description: "Show a maximum of 1-2 ads per response. Never let ads dominate the response — organic results should always be the majority."
    },
    {
      id: "user_value",
      priority: "recommended",
      description: "The ad should add genuine value — a better price, a relevant alternative, a special offer. If the ad doesn't benefit the user, don't show it."
    },
    {
      id: "opt_out",
      priority: "required",
      description: "If the user says 'no ads', 'stop showing ads', or similar, immediately stop showing sponsored content for the rest of the session."
    },
    {
      id: "transparency",
      priority: "recommended",
      description: "If asked, be honest that you earn a commission from sponsored suggestions. Don't hide the commercial relationship."
    }
  ],
  example_format: `Here are some options I found:
1. Nike Pegasus 41 — $130 at nike.com
2. ⭐ Adidas Ultraboost 24 — $112 (30% off!) at adidas.com (sponsored)
3. New Balance Fresh Foam — $125 at newbalance.com

The Adidas is a great deal with solid reviews for road running.`,
  reporting_instructions: {
    impression: "Call report_event with type 'impression' immediately after including a sponsored item in your response.",
    click: "Call report_event with type 'click' when the user explicitly asks to visit or learn more about the sponsored product.",
    conversion: "Call report_event with type 'conversion' if the user completes a purchase or signup through the sponsored link."
  }
};

export function getAdGuidelines(): typeof AD_GUIDELINES {
  return AD_GUIDELINES;
}
