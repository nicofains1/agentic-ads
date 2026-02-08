# Bulloak — Behavioral Specification

> **Source of truth** del comportamiento de Agentic Ads MCP.
> Cada hoja de este árbol es un behavior verificable.
> Cuando se agrega una feature, se agrega una rama acá primero.

### Status Legend

| Icon | Meaning |
|------|---------|
| 🟢 | Implemented — test exists (file referenced) |
| 🟡 | Partially covered — tested indirectly or incomplete |
| 🔴 | Not implemented — no test exists |

---

## 🏢 Publisher (Advertiser) Flow

### Onboarding

```
Publisher Onboarding
├── Crear advertiser → UUID, guardado en DB                                    🟢 tests/db/crud.test.ts
├── generateApiKey("advertiser", id)
│   ├── Key format: aa_adv_<64 hex chars>                                      🟢 tests/auth/middleware.test.ts
│   ├── Solo el hash SHA-256 se almacena en api_keys                           🟢 tests/auth/middleware.test.ts
│   └── El raw key se retorna una sola vez                                     🟢 tests/auth/middleware.test.ts
├── Conectar al MCP
│   ├── stdio: --api-key aa_adv_... → auth OK, log "Authenticated as adv"     🟢 tests/integration/stdio-auth.test.ts
│   ├── HTTP: Authorization: Bearer aa_adv_... → auth OK                       🟢 tests/integration/http-transport.test.ts
│   ├── Key inválida stdio → exit con "Auth failed"                            🟢 tests/integration/stdio-auth.test.ts
│   └── Key inválida HTTP → 401 JSON { error: "..." }                         🟢 tests/integration/http-transport.test.ts
└── Verificar acceso
    ├── Puede llamar: create_campaign, create_ad, get_campaign_analytics       🟢 tests/e2e.test.ts
    ├── NO puede llamar: report_event → "requires developer authentication"    🟢 tests/integration/mcp-stdio.test.ts
    └── Puede llamar tools públicos: search_ads, get_ad_guidelines             🟢 tests/e2e.test.ts
```

### Campaign Management

```
create_campaign
├── ✅ CPC campaign
│   ├── Input: name, objective=traffic, total_budget=100, cpc, bid=0.50       🟢 tests/db/crud.test.ts
│   ├── Output: { campaign_id, name, status: "active", ... }                  🟢 tests/db/crud.test.ts
│   └── DB: campaign creada con spent=0, status=active                        🟢 tests/db/crud.test.ts
├── ✅ CPM campaign
│   ├── Input: pricing_model=cpm, bid_amount=15                               🟢 tests/db/crud.test.ts
│   └── Output: campaign con pricing_model=cpm                                🟢 tests/db/crud.test.ts
├── ✅ CPA campaign
│   ├── Input: pricing_model=cpa, bid_amount=5.00, objective=conversions      🟢 tests/db/crud.test.ts
│   └── Output: campaign con pricing_model=cpa                                🟢 tests/db/crud.test.ts
├── ✅ Con daily_budget opcional
│   ├── Input: daily_budget=10                                                🟢 tests/db/crud.test.ts
│   └── DB: daily_budget guardado                                             🟢 tests/db/crud.test.ts
├── ✅ Con fechas opcionales
│   ├── Input: start_date, end_date en ISO format                             🟢 tests/db/crud.test.ts
│   └── DB: fechas guardadas                                                  🟢 tests/db/crud.test.ts
├── ❌ Sin auth → "Authentication required"                                    🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Con developer key → "requires advertiser authentication"                🟢 tests/integration/mcp-stdio.test.ts
└── ❌ Rate limit (>10/min) → "Rate limit exceeded. Retry after Xs."          🟢 tests/auth/rate-limiter.test.ts
```

```
create_ad
├── ✅ Ad completo
│   ├── Input: campaign_id, creative_text, link_url, keywords, etc.           🟢 tests/db/crud.test.ts
│   ├── Output: { ad_id, campaign_id, creative_text, keywords, status }       🟢 tests/db/crud.test.ts
│   └── DB: ad creado con quality_score=1.0, counters=0                       🟢 tests/db/crud.test.ts
├── ✅ Ad minimalista
│   ├── Input: solo campaign_id, creative_text, link_url, keywords (1+)       🟢 tests/db/crud.test.ts
│   └── Defaults: geo=ALL, language=en, categories=[]                         🟢 tests/db/crud.test.ts
├── ❌ Campaign inexistente → { error: "Campaign not found" }                  🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Campaign de otro advertiser → "does not belong to your account"         🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Campaign pausada → { error: "Campaign is not active" }                  🟢 tests/integration/mcp-stdio.test.ts
├── ❌ creative_text > 500 chars → error de validación Zod                     🟢 tests/integration/mcp-stdio.test.ts
├── ❌ keywords vacío → error de validación Zod (min 1)                        🟢 tests/integration/mcp-stdio.test.ts
├── ❌ link_url inválida → error de validación Zod (url)                       🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Sin auth → "Authentication required"                                    🟢 tests/integration/mcp-stdio.test.ts
└── ❌ Con developer key → "requires advertiser authentication"                🟢 tests/integration/mcp-stdio.test.ts
```

```
get_campaign_analytics
├── ✅ Campaign sin actividad
│   ├── Output: totals { impressions:0, clicks:0, conversions:0, spend:0 }    🟢 tests/e2e.test.ts
│   ├── rates { ctr: 0, cvr: 0 }                                             🟢 tests/e2e.test.ts
│   └── budget { total, spent: 0, remaining: total }                          🟢 tests/e2e.test.ts
├── ✅ Campaign con actividad
│   ├── Output: totals reflejan eventos reportados                            🟢 tests/e2e.test.ts
│   ├── rates: ctr = clicks/impressions * 100, cvr = conversions/clicks * 100 🟢 tests/e2e.test.ts
│   ├── budget.spent = suma de costos                                         🟢 tests/e2e.test.ts
│   └── budget.remaining = total - spent                                      🟢 tests/e2e.test.ts
├── ✅ Campaign con múltiples ads
│   ├── Output: totals son agregados de todos los ads                         🟢 tests/integration/mcp-stdio.test.ts
│   └── ads[]: cada ad con stats individuales (creative truncado 50 chars)    🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Campaign inexistente → { error: "Campaign not found" }                  🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Campaign de otro advertiser → "does not belong to your account"         🟢 tests/integration/mcp-stdio.test.ts
└── ❌ Sin auth / developer key → error de auth                                🟢 tests/integration/mcp-stdio.test.ts
```

```
update_campaign
├── ✅ Update fields parciales
│   ├── Input: campaign_id + name, objective, total_budget, daily_budget, bid  🟢 tests/integration/mcp-stdio.test.ts
│   ├── Output: updated campaign object con todos los campos                   🟢 tests/integration/mcp-stdio.test.ts
│   └── DB: solo campos enviados se actualizan                                 🟢 tests/integration/mcp-stdio.test.ts
├── ✅ Status transitions (pause / resume)
│   ├── active → paused                                                        🟢 tests/integration/mcp-stdio.test.ts
│   ├── paused → active                                                        🟢 tests/integration/mcp-stdio.test.ts
│   └── completed → error "Campaign is completed and cannot be modified"       🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Reducir budget debajo de spent → error "cannot be less than spent"       🟢 tests/integration/mcp-stdio.test.ts
├── ❌ pricing_model no se puede cambiar → error "cannot be changed"            🟡 (server rejects via Zod — no pricing_model in schema; not explicitly tested)
├── ❌ Campaign inexistente → { error: "Campaign not found" }                   🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Campaign de otro advertiser → "does not belong to your account"          🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Sin auth → "Authentication required"                                     🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Con developer key → "requires advertiser authentication"                 🟢 tests/integration/mcp-stdio.test.ts
└── ❌ Rate limit (>20/min) → "Rate limit exceeded"                             🟢 tests/auth/rate-limiter.test.ts
```

```
list_campaigns
├── ✅ Listar todos los campaigns del advertiser
│   ├── Output: campaigns[] con id, name, status, pricing, budget summary     🟢 tests/integration/mcp-stdio.test.ts
│   └── Ordenado por created_at DESC                                           🟢 tests/integration/mcp-stdio.test.ts
├── ✅ Filtrar por status
│   ├── Input: status=active → solo campaigns activos                          🟢 tests/integration/mcp-stdio.test.ts
│   └── Input: status=paused → solo campaigns pausados                         🟢 tests/integration/mcp-stdio.test.ts
├── ✅ Advertiser sin campaigns → { campaigns: [] }                             🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Sin auth → "Authentication required"                                     🟢 tests/integration/mcp-stdio.test.ts
├── ❌ Con developer key → "requires advertiser authentication"                 🟢 tests/integration/mcp-stdio.test.ts
└── ❌ Rate limit (>30/min) → "Rate limit exceeded"                             🟢 tests/auth/rate-limiter.test.ts
```

### Budget Lifecycle

```
Budget Lifecycle
├── Campaign activa con budget disponible
│   ├── search_ads la incluye en resultados                                   🟢 tests/db/crud.test.ts
│   └── report_event la acepta                                                🟢 tests/billing/pricing.test.ts
├── Budget se agota (spent >= total_budget)
│   ├── Campaign status → "paused" (automático en report_event)               🟢 tests/billing/pricing.test.ts
│   ├── search_ads ya NO la incluye (filtro: c.spent < c.total_budget)        🟢 tests/db/crud.test.ts
│   └── report_event → { error: "Campaign budget exhausted" }                 🟢 tests/billing/pricing.test.ts
├── Ejemplo CPC: budget=$10, bid=$0.50
│   ├── 20 clicks → spent=$10 → auto-pause                                   🟢 tests/billing/pricing.test.ts
│   ├── Click 21 → error "Campaign budget exhausted"                          🟢 tests/billing/pricing.test.ts
│   └── Impressions son gratis (no agotan budget)                             🟢 tests/billing/pricing.test.ts
├── Ejemplo CPM: budget=$50, bid=$15
│   ├── Cada impression cobra $0.015 (15/1000)                                🟢 tests/billing/pricing.test.ts
│   ├── ~3333 impressions agotan budget                                       🟢 tests/billing/pricing.test.ts
│   └── Clicks son gratis                                                     🟢 tests/billing/pricing.test.ts
└── Ejemplo CPA: budget=$100, bid=$5
    ├── Cada conversion cobra $5                                              🟢 tests/billing/pricing.test.ts
    ├── 20 conversions agotan budget                                          🟢 tests/billing/pricing.test.ts
    └── Impressions y clicks son gratis                                       🟢 tests/billing/pricing.test.ts
```

---

## 🤖 Consumer (Developer/Bot) Flow

### Onboarding

```
Consumer Onboarding
├── Crear developer → UUID, guardado en DB                                     🟢 tests/db/crud.test.ts
├── generateApiKey("developer", id)
│   └── Key format: aa_dev_<64 hex chars>                                      🟢 tests/auth/middleware.test.ts
├── Conectar al MCP
│   ├── stdio: --api-key aa_dev_... → auth OK                                 🟢 tests/integration/mcp-stdio.test.ts
│   ├── HTTP: Authorization: Bearer aa_dev_... → auth OK                       🟢 tests/integration/http-transport.test.ts
│   └── Sin key → modo público (solo tools sin auth)                           🟢 tests/integration/http-transport.test.ts + stdio-auth.test.ts
├── Verificar acceso
│   ├── Puede llamar: search_ads, report_event, get_ad_guidelines             🟢 tests/e2e.test.ts
│   ├── NO puede llamar: create_campaign → "requires advertiser auth"          🟢 tests/integration/mcp-stdio.test.ts
│   └── NO puede llamar: create_ad, get_campaign_analytics                     🟢 tests/integration/mcp-stdio.test.ts
└── Leer get_ad_guidelines
    ├── Output: { rules: [...], example_format, reporting_instructions }       🟢 tests/tools/guidelines.test.ts
    ├── 7 reglas definidas                                                     🟢 tests/tools/guidelines.test.ts
    └── No requiere auth                                                       🟢 tests/tools/guidelines.test.ts
```

### Ad Discovery — search_ads

```
search_ads
├── Query Rica (best case)
│   ├── Input: query + keywords + category + geo + language                    🟢 tests/e2e.test.ts
│   ├── Output: ads[] con relevance_score alto (>0.5)                         🟢 tests/matching/keyword-matcher.test.ts
│   ├── Ad correcto rankeado primero (keywords exactos + category)            🟢 tests/matching/ranker.test.ts
│   ├── Cada ad tiene: ad_id, advertiser_name, creative_text, link_url,
│   │   relevance_score, disclosure="sponsored"                               🟢 tests/matching/ranker.test.ts
│   └── max_results respetado                                                 🟢 tests/matching/ranker.test.ts
│
├── Query Pobre (worst case)
│   ├── query="quiero comprar algo"
│   │   ├── extractKeywords filtra stopwords                                  🟢 tests/matching/keyword-matcher.test.ts
│   │   └── No matchea con ads reales → vacío o score muy bajo               🟢 tests/matching/keyword-matcher.test.ts
│   ├── keywords=["stuff","things"]
│   │   └── No matchea → resultado vacío o bajo threshold                     🟢 tests/matching/keyword-matcher.test.ts
│   ├── Sin query, sin keywords, sin category
│   │   └── matchAds retorna [] (early return)                                🟢 tests/matching/keyword-matcher.test.ts
│   └── PRINCIPIO: nunca devolver ads irrelevantes                            🟢 tests/matching/keyword-matcher.test.ts
│
├── Query Mediana
│   ├── query="running shoes" sin keywords explícitos
│   │   ├── extractKeywords → ["running", "shoes"]                            🟢 tests/matching/keyword-matcher.test.ts
│   │   ├── Partial match con "running shoes" keyword                         🟢 tests/matching/keyword-matcher.test.ts
│   │   └── Score medio (~0.3-0.5)                                            🟢 tests/matching/keyword-matcher.test.ts
│   ├── Solo category="footwear" sin query
│   │   ├── category_match = true (+0.2)                                      🟢 tests/matching/keyword-matcher.test.ts
│   │   └── Score bajo pero sobre threshold                                   🟢 tests/matching/keyword-matcher.test.ts
│   └── keywords=["sneakers"] sin query
│       ├── Exact match con ad que tiene "sneakers"                           🟢 tests/matching/keyword-matcher.test.ts
│       └── Score: 0.3 + 0.1 + 0.05 = 0.45                                   🟢 tests/matching/keyword-matcher.test.ts
│
├── Geo/Language Filtering
│   ├── geo="US" → ads con geo=ALL o geo=US                                   🟢 tests/db/crud.test.ts
│   ├── geo="UK" → solo ads geo=ALL (US-only excluidos)                       🟢 tests/e2e.test.ts
│   ├── language="zh" → NO matchea ads language=en                            🟢 tests/e2e.test.ts
│   ├── language="en" → matchea ads language=en                               🟢 tests/matching/keyword-matcher.test.ts
│   └── Sin geo → ads con cualquier geo pasan                                 🟢 tests/matching/keyword-matcher.test.ts
│
├── Ranking
│   ├── relevance² × (0.7 + 0.3 × normalizedBid) × quality_score            🟢 tests/matching/ranker.test.ts
│   ├── Ad relevante bid bajo > ad irrelevante bid alto                       🟢 tests/matching/ranker.test.ts
│   ├── Misma relevancia → bid más alto gana                                  🟢 tests/matching/ranker.test.ts
│   ├── quality_score bajo penaliza                                           🟢 tests/matching/ranker.test.ts
│   └── MIN_RELEVANCE_THRESHOLD = 0.1: debajo se descarta                    🟢 tests/matching/ranker.test.ts
│
└── Edge Cases
    ├── No hay ads en DB → { ads: [], message: "No ads available" }           🟢 tests/integration/mcp-stdio.test.ts
    ├── Todos los campaigns pausados → resultado vacío                        🟢 tests/db/crud.test.ts
    ├── Todos los campaigns budget agotado → resultado vacío                  🟢 tests/db/crud.test.ts
    ├── max_results=1 → solo el mejor ad                                      🟢 tests/matching/ranker.test.ts
    ├── max_results=10 con 3 ads → devuelve 3                                🟢 tests/matching/ranker.test.ts
    └── No requiere auth (tool público)                                       🟢 tests/e2e.test.ts
```

### Event Reporting — report_event

```
report_event
├── Requiere developer auth (aa_dev_...)                                       🟢 tests/e2e.test.ts

├── Ad Shown, NOT Consumed (impression only)
│   ├── CPC campaign + impression
│   │   ├── amount_charged = $0                                               🟢 tests/billing/pricing.test.ts
│   │   ├── developer_revenue = $0                                            🟢 tests/billing/pricing.test.ts
│   │   ├── platform_revenue = $0                                             🟢 tests/billing/pricing.test.ts
│   │   ├── DB: ad.impressions += 1, ad.spend += 0                            🟢 tests/db/crud.test.ts
│   │   └── DB: campaign.spent no cambia                                      🟢 tests/billing/pricing.test.ts
│   ├── CPM campaign + impression
│   │   ├── amount_charged = bid_amount / 1000                                🟢 tests/billing/pricing.test.ts
│   │   ├── developer_revenue = amount * 0.7                                  🟢 tests/billing/pricing.test.ts
│   │   ├── platform_revenue = amount * 0.3                                   🟢 tests/billing/pricing.test.ts
│   │   ├── DB: ad.impressions += 1, ad.spend += amount                       🟢 tests/db/crud.test.ts
│   │   └── DB: campaign.spent += amount                                      🟢 tests/billing/pricing.test.ts
│   └── CPA campaign + impression
│       ├── amount_charged = $0                                               🟢 tests/billing/pricing.test.ts
│       └── DB: ad.impressions += 1                                           🟢 tests/db/crud.test.ts

├── Ad Shown AND Consumed
│   ├── CPC campaign + click
│   │   ├── amount_charged = bid_amount ($0.50)                               🟢 tests/billing/pricing.test.ts
│   │   ├── developer_revenue = $0.35 (70%)                                   🟢 tests/billing/pricing.test.ts
│   │   ├── platform_revenue = $0.15 (30%)                                    🟢 tests/billing/pricing.test.ts
│   │   ├── DB: ad.clicks += 1, ad.spend += 0.50                              🟢 tests/db/crud.test.ts
│   │   ├── DB: campaign.spent += 0.50                                        🟢 tests/billing/pricing.test.ts
│   │   └── Output: { event_id, event_type, amount_charged, ... }             🟢 tests/billing/pricing.test.ts
│   ├── CPM campaign + click
│   │   ├── amount_charged = $0 (CPM solo cobra impressions)                  🟢 tests/billing/pricing.test.ts
│   │   └── DB: ad.clicks += 1, ad.spend += 0                                🟢 tests/db/crud.test.ts
│   ├── CPA campaign + conversion
│   │   ├── amount_charged = bid_amount completo                              🟢 tests/billing/pricing.test.ts
│   │   ├── developer_revenue = amount * 0.7                                  🟢 tests/billing/pricing.test.ts
│   │   └── DB: campaign.spent += amount                                      🟢 tests/billing/pricing.test.ts
│   └── CPA campaign + click (no conversion)
│       ├── amount_charged = $0                                               🟢 tests/billing/pricing.test.ts
│       └── Solo click registrado, sin cobro                                  🟢 tests/billing/pricing.test.ts

├── Múltiples eventos del mismo ad
│   ├── Cada evento es un registro separado en events table                   🟢 tests/billing/pricing.test.ts
│   ├── ad.impressions/clicks/conversions incrementan acumulativamente        🟢 tests/billing/pricing.test.ts
│   └── campaign.spent incrementa acumulativamente                            🟢 tests/billing/pricing.test.ts

├── Atomicity (transacción SQLite)
│   ├── insertEvent + updateAdStats + updateCampaignSpent en una transacción  🟢 tests/billing/pricing.test.ts
│   ├── Si falla alguno → rollback completo                                   🟢 tests/billing/pricing.test.ts
│   └── Auto-pause check dentro de la transacción                             🟢 tests/billing/pricing.test.ts

├── Output
│   ├── Success: { event_id, event_type, amount_charged, dev_rev, remaining } 🟢 tests/billing/pricing.test.ts
│   └── remaining_budget = total - spent_antes - cost_este_evento             🟢 tests/billing/pricing.test.ts

└── Error Paths
    ├── ❌ Sin auth → "Authentication required"                                🟢 tests/integration/mcp-stdio.test.ts
    ├── ❌ Con advertiser key → "requires developer authentication"            🟢 tests/integration/mcp-stdio.test.ts
    ├── ❌ ad_id inexistente → { error: "Ad not found" }                       🟢 tests/billing/pricing.test.ts
    ├── ❌ Campaign no activa → { error: "Campaign not active" }               🟢 tests/billing/pricing.test.ts
    ├── ❌ Budget agotado → { error: "Campaign budget exhausted" }             🟢 tests/billing/pricing.test.ts
    └── ❌ Rate limit (>120/min) → "Rate limit exceeded"                       🟢 tests/auth/rate-limiter.test.ts
```

---

## 💰 Billing & Revenue

```
Revenue Split
├── Fórmula: 70% developer / 30% platform                                     🟢 tests/billing/pricing.test.ts
├── CPC click $0.50 → dev $0.35, platform $0.15                               🟢 tests/billing/pricing.test.ts
├── CPM impression (bid=$15) → dev $0.0105, platform $0.0045                   🟢 tests/billing/pricing.test.ts
├── CPA conversion (bid=$5) → dev $3.50, platform $1.50                        🟢 tests/billing/pricing.test.ts
├── Eventos no-billable → $0 / $0 / $0                                        🟢 tests/billing/pricing.test.ts
└── DB: dev_revenue + platform_revenue = amount_charged                        🟢 tests/billing/pricing.test.ts

Pricing Models
├── CPC (Cost Per Click)
│   ├── Cobra en: click                                                       🟢 tests/billing/pricing.test.ts
│   ├── Gratis: impression, conversion                                        🟢 tests/billing/pricing.test.ts
│   └── amount = bid_amount                                                   🟢 tests/billing/pricing.test.ts
├── CPM (Cost Per Mille)
│   ├── Cobra en: impression                                                  🟢 tests/billing/pricing.test.ts
│   ├── Gratis: click, conversion                                             🟢 tests/billing/pricing.test.ts
│   └── amount = bid_amount / 1000                                            🟢 tests/billing/pricing.test.ts
└── CPA (Cost Per Action)
    ├── Cobra en: conversion                                                  🟢 tests/billing/pricing.test.ts
    ├── Gratis: impression, click                                             🟢 tests/billing/pricing.test.ts
    └── amount = bid_amount                                                   🟢 tests/billing/pricing.test.ts
```

---

## 🔐 Auth & Security

```
API Keys
├── Formato
│   ├── Advertiser: aa_adv_<64 hex chars> (71 chars total)                    🟢 tests/auth/middleware.test.ts
│   ├── Developer: aa_dev_<64 hex chars> (71 chars total)                     🟢 tests/auth/middleware.test.ts
│   └── Prefijo identifica tipo sin DB lookup                                 🟢 tests/auth/middleware.test.ts
├── Storage
│   ├── Solo SHA-256 hash en api_keys.key_hash                                🟢 tests/auth/middleware.test.ts
│   ├── Raw key retornado una vez en generateApiKey()                         🟢 tests/auth/middleware.test.ts
│   └── Nunca plaintext en DB                                                 🟢 tests/auth/middleware.test.ts
├── Validación
│   ├── Key vacía → AuthError "API key is required"                           🟢 tests/auth/middleware.test.ts
│   ├── Prefijo desconocido → AuthError "Invalid API key format"              🟢 tests/auth/middleware.test.ts
│   ├── Key no existe en DB → AuthError "Invalid API key"                     🟢 tests/auth/middleware.test.ts
│   └── Prefijo ≠ entity_type en DB → AuthError "API key type mismatch"       🟢 tests/auth/middleware.test.ts
└── Access Control
    ├── Advertiser key → create_campaign, create_ad, analytics                🟢 tests/e2e.test.ts
    ├── Developer key → report_event                                          🟢 tests/e2e.test.ts
    ├── Cross-role → error claro                                              🟢 tests/integration/mcp-stdio.test.ts
    └── Ownership: advertiser A no ve campaigns de advertiser B               🟢 tests/integration/mcp-stdio.test.ts

Rate Limiting
├── Sliding window por (key_id, tool_name)                                    🟢 tests/auth/rate-limiter.test.ts
├── Límites
│   ├── search_ads: 60/min                                                    🟢 tests/auth/rate-limiter.test.ts
│   ├── report_event: 120/min                                                 🟢 tests/auth/rate-limiter.test.ts
│   ├── create_campaign: 10/min                                               🟢 tests/auth/rate-limiter.test.ts
│   ├── create_ad: 10/min                                                     🟢 tests/auth/rate-limiter.test.ts
│   ├── get_campaign_analytics: 30/min                                        🟢 tests/auth/rate-limiter.test.ts
│   ├── get_ad_guidelines: 60/min                                             🟢 tests/auth/rate-limiter.test.ts
│   ├── update_campaign: 20/min                                               🟢 tests/auth/rate-limiter.test.ts
│   └── list_campaigns: 30/min                                                🟢 tests/auth/rate-limiter.test.ts
├── Excedido → RateLimitError con retryAfterMs                                🟢 tests/auth/rate-limiter.test.ts
├── Después del window → se resetea                                           🟢 tests/auth/rate-limiter.test.ts
├── Keys diferentes no interfieren                                            🟢 tests/auth/rate-limiter.test.ts
├── Tools diferentes no interfieren                                           🟢 tests/auth/rate-limiter.test.ts
└── Cleanup periódico de entries expirados (cada 60s)                         🟢 tests/auth/rate-limiter.test.ts
```

---

## 🔌 Integration

```
Transport: stdio
├── Arranque: node dist/server.js --stdio                                      🟢 tests/integration/mcp-stdio.test.ts
├── Auth: --api-key flag                                                       🟢 tests/integration/stdio-auth.test.ts
├── Auth: env AGENTIC_ADS_API_KEY                                              🟢 tests/integration/stdio-auth.test.ts
├── Sin key → log "running without authentication"                             🟢 tests/integration/stdio-auth.test.ts
├── Key inválida → log "Auth failed" + process.exit(1)                         🟢 tests/integration/stdio-auth.test.ts
├── Protocolo: JSON-RPC 2.0 via stdin/stdout                                   🟢 tests/integration/mcp-stdio.test.ts
└── Logs a stderr (no contamina protocolo)                                     🟢 tests/integration/stdio-auth.test.ts

Transport: HTTP
├── Arranque: node dist/server.js --http [--port 3000]                         🟢 tests/integration/http-transport.test.ts
├── Health: GET /health → 200 { status, server, version }                      🟢 tests/integration/http-transport.test.ts
├── MCP: POST /mcp → JSON-RPC sobre Streamable HTTP                            🟢 tests/integration/http-transport.test.ts
├── Auth: Authorization: Bearer <key> header
│   ├── Key válida → auth almacenada por sessionId                            🟢 tests/integration/http-transport.test.ts
│   ├── Key inválida → 401 { error: "..." }                                   🟢 tests/integration/http-transport.test.ts
│   └── Sin header → modo público                                             🟢 tests/integration/http-transport.test.ts
├── Sessions
│   ├── Nueva conexión → sessionId UUID                                       🟢 tests/integration/http-transport.test.ts
│   ├── mcp-session-id header → reutiliza sesión                              🟢 tests/integration/http-transport.test.ts
│   ├── onclose → cleanup transport + auth                                    🟢 tests/integration/http-transport.test.ts
│   └── Auth se puede actualizar entre requests                               🟡 (logic exists in server.ts; not directly tested via tool call)
└── 404: paths desconocidos → { error: "Not found..." }                       🟢 tests/integration/http-transport.test.ts

OpenClaw Skill
├── SKILL.md frontmatter YAML válido                                           🟢 tests/openclaw-skill.test.ts
├── mcp-config.example.json funcional                                          🟢 tests/openclaw-skill.test.ts
└── README con setup guide                                                     🟢 tests/openclaw-skill.test.ts
```

---

## 📊 Matching & Ranking Quality

```
Keyword Matching (matchAds)
├── Exact match: "running shoes" == "running shoes" → +0.30                   🟢 tests/matching/keyword-matcher.test.ts
├── Partial match: "shoe" ⊂ "running shoes" → +0.15                          🟢 tests/matching/keyword-matcher.test.ts
├── Category match: query.category in ad.categories → +0.20                   🟢 tests/matching/keyword-matcher.test.ts
├── Geo match: query.geo == ad.geo OR ad.geo == "ALL" → +0.10                🟢 tests/matching/keyword-matcher.test.ts
├── Language match: query.language == ad.language → +0.05                     🟢 tests/matching/keyword-matcher.test.ts
├── Score normalizado a max 1.0                                               🟢 tests/matching/keyword-matcher.test.ts
├── Threshold: score > 0.05 para incluir                                      🟢 tests/matching/keyword-matcher.test.ts
├── Sin keywords ni category → retorna []                                     🟢 tests/matching/keyword-matcher.test.ts
└── Stopwords filtrados
    ├── English: a, the, is, want, need, best, buy, find, get...              🟢 tests/matching/keyword-matcher.test.ts
    └── Spanish: un, una, el, la, quiero, necesito, busco, comprar...         🟢 tests/matching/keyword-matcher.test.ts

extractKeywords
├── Lowercase                                                                  🟢 tests/matching/keyword-matcher.test.ts
├── Remove punctuation                                                         🟢 tests/matching/keyword-matcher.test.ts
├── Split by whitespace                                                        🟢 tests/matching/keyword-matcher.test.ts
├── Filter stopwords                                                           🟢 tests/matching/keyword-matcher.test.ts
└── Filter length <= 1                                                         🟢 tests/matching/keyword-matcher.test.ts

Ranking (rankAds)
├── Formula: relevance² × bidFactor × quality_score                           🟢 tests/matching/ranker.test.ts
├── bidFactor = 0.7 + 0.3 × (bid / maxBid)
│   ├── Rango: 0.7 (bid mínimo) a 1.0 (bid máximo)                           🟢 tests/matching/ranker.test.ts
│   └── Bid contribuye solo 30% al score final                                🟢 tests/matching/ranker.test.ts
├── relevance²: exponencial penaliza baja relevancia
│   ├── relevance 0.9 → 0.81                                                 🟢 tests/matching/ranker.test.ts
│   ├── relevance 0.5 → 0.25                                                 🟢 tests/matching/ranker.test.ts
│   └── relevance 0.15 → 0.0225                                              🟢 tests/matching/ranker.test.ts
├── MIN_RELEVANCE_THRESHOLD = 0.1                                             🟢 tests/matching/ranker.test.ts
├── Sorted por score descendente                                              🟢 tests/matching/ranker.test.ts
├── Sliced a maxResults                                                       🟢 tests/matching/ranker.test.ts
└── Output: RankedAd[] con disclosure: "sponsored"                            🟢 tests/matching/ranker.test.ts
```

---

## 🗃️ Database

```
Schema
├── advertisers: id, name, company?, email?, created_at                       🟢 tests/db/schema.test.ts
├── developers: id, name, email?, reputation_score, created_at                🟢 tests/db/schema.test.ts
├── campaigns: id, advertiser_id(FK), name, objective, status, budgets...     🟢 tests/db/schema.test.ts
├── ads: id, campaign_id(FK), creative_text, link_url, keywords(JSON)...      🟢 tests/db/schema.test.ts
├── events: id, ad_id(FK), developer_id(FK), event_type, amounts...           🟢 tests/db/schema.test.ts
└── api_keys: id, key_hash(unique), entity_type, entity_id, created_at        🟢 tests/db/schema.test.ts

Constraints
├── campaign.status IN (draft, active, paused, completed)                     🟢 tests/db/schema.test.ts
├── ad.status IN (pending, active, paused)                                    🟢 tests/db/schema.test.ts
├── event.event_type IN (impression, click, conversion)                       🟢 tests/db/schema.test.ts
├── campaign.pricing_model IN (cpm, cpc, cpa, hybrid)                         🟢 tests/db/schema.test.ts
├── api_key.entity_type IN (advertiser, developer)                            🟢 tests/db/schema.test.ts
└── Foreign keys enforced (PRAGMA foreign_keys = ON)                          🟢 tests/db/schema.test.ts

Indices
├── ads: campaign_id, status                                                  🟢 tests/db/schema.test.ts
├── campaigns: advertiser_id, status                                          🟢 tests/db/schema.test.ts
├── events: ad_id, developer_id, created_at                                   🟢 tests/db/schema.test.ts
└── api_keys: key_hash                                                        🟢 tests/db/schema.test.ts

Settings
├── WAL mode (concurrent reads)                                               🟢 tests/db/schema.test.ts
└── Foreign keys ON                                                           🟢 tests/db/schema.test.ts
```
