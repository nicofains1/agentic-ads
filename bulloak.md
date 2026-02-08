# Bulloak — Behavioral Specification

> **Source of truth** del comportamiento de Agentic Ads MCP.
> Cada hoja de este árbol es un behavior verificable.
> Cuando se agrega una feature, se agrega una rama acá primero.

---

## 🏢 Publisher (Advertiser) Flow

### Onboarding

```
Publisher Onboarding
├── Crear advertiser → se genera UUID, se guarda en DB
├── generateApiKey("advertiser", id)
│   ├── Key format: aa_adv_<64 hex chars>
│   ├── Solo el hash SHA-256 se almacena en api_keys
│   └── El raw key se retorna una sola vez
├── Conectar al MCP
│   ├── stdio: --api-key aa_adv_... → auth OK, log "Authenticated as advertiser"
│   ├── HTTP: Authorization: Bearer aa_adv_... → auth OK
│   ├── Key inválida stdio → exit con "Auth failed"
│   └── Key inválida HTTP → 401 JSON { error: "..." }
└── Verificar acceso
    ├── Puede llamar: create_campaign, create_ad, get_campaign_analytics
    ├── NO puede llamar: report_event → "requires developer authentication"
    └── Puede llamar tools públicos: search_ads, get_ad_guidelines
```

### Campaign Management

```
create_campaign
├── ✅ CPC campaign
│   ├── Input: name, objective=traffic, total_budget=100, pricing_model=cpc, bid_amount=0.50
│   ├── Output: { campaign_id, name, status: "active", ... }
│   └── DB: campaign creada con spent=0, status=active
├── ✅ CPM campaign
│   ├── Input: pricing_model=cpm, bid_amount=15
│   └── Output: campaign con pricing_model=cpm
├── ✅ CPA campaign
│   ├── Input: pricing_model=cpa, bid_amount=5.00, objective=conversions
│   └── Output: campaign con pricing_model=cpa
├── ✅ Con daily_budget opcional
│   ├── Input: daily_budget=10
│   └── DB: daily_budget guardado
├── ✅ Con fechas opcionales
│   ├── Input: start_date, end_date en ISO format
│   └── DB: fechas guardadas
├── ❌ Sin auth → "Authentication required"
├── ❌ Con developer key → "requires advertiser authentication"
└── ❌ Rate limit (>10/min) → "Rate limit exceeded. Retry after Xs."
```

```
create_ad
├── ✅ Ad completo
│   ├── Input: campaign_id, creative_text, link_url, keywords, categories, geo, language
│   ├── Output: { ad_id, campaign_id, creative_text, keywords, status: "active" }
│   └── DB: ad creado con quality_score=1.0, impressions/clicks/conversions=0
├── ✅ Ad minimalista
│   ├── Input: solo campaign_id, creative_text, link_url, keywords (1+)
│   └── Defaults: geo=ALL, language=en, categories=[]
├── ❌ Campaign inexistente → { error: "Campaign not found" }, isError=true
├── ❌ Campaign de otro advertiser → { error: "Campaign does not belong to your account" }
├── ❌ Campaign pausada → { error: "Campaign is not active" }
├── ❌ creative_text > 500 chars → error de validación Zod
├── ❌ keywords vacío → error de validación Zod (min 1)
├── ❌ link_url inválida → error de validación Zod (url)
├── ❌ Sin auth → "Authentication required"
└── ❌ Con developer key → "requires advertiser authentication"
```

```
get_campaign_analytics
├── ✅ Campaign sin actividad
│   ├── Output: totals { impressions:0, clicks:0, conversions:0, spend:0 }
│   ├── rates { ctr: 0, cvr: 0 }
│   └── budget { total, spent: 0, remaining: total }
├── ✅ Campaign con actividad
│   ├── Output: totals reflejan eventos reportados
│   ├── rates: ctr = clicks/impressions * 100, cvr = conversions/clicks * 100
│   ├── budget.spent = suma de costos
│   └── budget.remaining = total - spent
├── ✅ Campaign con múltiples ads
│   ├── Output: totals son agregados de todos los ads
│   └── ads[]: cada ad con sus stats individuales (creative truncado a 50 chars)
├── ❌ Campaign inexistente → { error: "Campaign not found" }
├── ❌ Campaign de otro advertiser → { error: "Campaign does not belong to your account" }
└── ❌ Sin auth / developer key → error de auth
```

### Budget Lifecycle

```
Budget Lifecycle
├── Campaign activa con budget disponible
│   ├── search_ads la incluye en resultados
│   └── report_event la acepta
├── Budget se agota (spent >= total_budget)
│   ├── Campaign status → "paused" (automático en report_event)
│   ├── search_ads ya NO la incluye (filtro: c.spent < c.total_budget)
│   └── report_event → { error: "Campaign budget exhausted", campaign_paused: true }
├── Ejemplo CPC: budget=$10, bid=$0.50
│   ├── 20 clicks → spent=$10 → auto-pause
│   ├── Click 21 → error "Campaign budget exhausted"
│   └── Impressions son gratis (no agotan budget)
├── Ejemplo CPM: budget=$50, bid=$15
│   ├── Cada impression cobra $0.015 (15/1000)
│   ├── ~3333 impressions agotan budget
│   └── Clicks son gratis
└── Ejemplo CPA: budget=$100, bid=$5
    ├── Cada conversion cobra $5
    ├── 20 conversions agotan budget
    └── Impressions y clicks son gratis
```

---

## 🤖 Consumer (Developer/Bot) Flow

### Onboarding

```
Consumer Onboarding
├── Crear developer → se genera UUID, se guarda en DB
├── generateApiKey("developer", id)
│   └── Key format: aa_dev_<64 hex chars>
├── Conectar al MCP
│   ├── stdio: --api-key aa_dev_... → auth OK
│   ├── HTTP: Authorization: Bearer aa_dev_... → auth OK
│   └── Sin key → modo público (solo tools sin auth)
├── Verificar acceso
│   ├── Puede llamar: search_ads, report_event, get_ad_guidelines
│   ├── NO puede llamar: create_campaign → "requires advertiser authentication"
│   └── NO puede llamar: create_ad, get_campaign_analytics
└── Leer get_ad_guidelines
    ├── Output: { rules: [...], example_format, reporting_instructions }
    ├── 7 reglas definidas (disclosure, relevance, integration, frequency, value, opt-out, transparency)
    └── No requiere auth
```

### Ad Discovery — search_ads

```
search_ads
├── Query Rica (best case)
│   ├── Input: query="best running shoes for marathon", keywords=["running shoes","sneakers"], category="footwear", geo="US", language="en"
│   ├── Output: ads[] con relevance_score alto (>0.5)
│   ├── Ad de Adidas Ultraboost aparece primero (keywords exactos + category)
│   ├── Cada ad tiene: ad_id, advertiser_name, creative_text, link_url, relevance_score, disclosure="sponsored"
│   └── max_results respetado
│
├── Query Pobre (worst case)
│   ├── Input: query="quiero comprar algo"
│   │   ├── extractKeywords filtra stopwords → queda "comprar", "algo"
│   │   └── Solo matchea si hay ads con esos keywords (probablemente no)
│   ├── Input: keywords=["stuff","things"]
│   │   └── No matchea con keywords reales → resultado vacío o score muy bajo
│   ├── Input: sin query, sin keywords, sin category
│   │   └── matchAds retorna [] (early return)
│   └── PRINCIPIO: nunca devolver ads irrelevantes. Mejor vacío que spam.
│
├── Query Mediana
│   ├── Input: query="running shoes" (sin keywords explícitos)
│   │   ├── extractKeywords("running shoes") → ["running", "shoes"]
│   │   ├── Partial match con "running shoes" keyword del ad
│   │   └── Score medio (~0.3-0.5)
│   ├── Input: solo category="footwear" (sin query)
│   │   ├── category_match = true (+0.2)
│   │   ├── geo_match + language_match (+0.15)
│   │   └── Score bajo pero sobre threshold
│   └── Input: keywords=["sneakers"] sin query
│       ├── Exact match con ad que tiene "sneakers"
│       └── Score: 0.3 (exact) + 0.1 (geo) + 0.05 (language) = 0.45
│
├── Geo/Language Filtering
│   ├── geo="US" → ads con geo=ALL o geo=US (filtro DB)
│   ├── geo="UK" → ads con geo=ALL solamente (US-only excluidos)
│   ├── language="zh" → NO matchea ads en=en (filtro DB)
│   ├── language="en" → matchea ads language=en
│   └── Sin geo → ads con cualquier geo pasan (filtro no se aplica)
│
├── Ranking
│   ├── Formula: relevance² × (0.7 + 0.3 × normalizedBid) × quality_score
│   ├── Relevance domina: ad relevante con bid bajo > ad irrelevante con bid alto
│   ├── Bid es tiebreaker (30% peso): misma relevancia → bid más alto gana
│   ├── quality_score multiplica: ads con quality_score bajo son penalizados
│   └── MIN_RELEVANCE_THRESHOLD = 0.1: por debajo se descarta
│
└── Edge Cases
    ├── No hay ads en DB → { ads: [], message: "No ads available" }
    ├── Todos los campaigns pausados → no pasan filtro → resultado vacío
    ├── Todos los campaigns con budget agotado → no pasan filtro → resultado vacío
    ├── max_results=1 → solo el mejor ad
    ├── max_results=10 con 3 ads elegibles → devuelve 3
    └── No requiere auth (tool público)
```

### Event Reporting — report_event

```
report_event
├── Requiere developer auth (aa_dev_...)
│
├── Ad Shown, NOT Consumed (impression only)
│   ├── CPC campaign + impression
│   │   ├── amount_charged = $0 (CPC no cobra impressions)
│   │   ├── developer_revenue = $0
│   │   ├── platform_revenue = $0
│   │   ├── DB: ad.impressions += 1, ad.spend += 0
│   │   └── DB: campaign.spent no cambia
│   ├── CPM campaign + impression
│   │   ├── amount_charged = bid_amount / 1000
│   │   ├── developer_revenue = amount * 0.7
│   │   ├── platform_revenue = amount * 0.3
│   │   ├── DB: ad.impressions += 1, ad.spend += amount
│   │   └── DB: campaign.spent += amount
│   └── CPA campaign + impression
│       ├── amount_charged = $0 (CPA solo cobra conversions)
│       └── DB: ad.impressions += 1
│
├── Ad Shown AND Consumed
│   ├── CPC campaign + click
│   │   ├── amount_charged = bid_amount ($0.50)
│   │   ├── developer_revenue = $0.35 (70%)
│   │   ├── platform_revenue = $0.15 (30%)
│   │   ├── DB: ad.clicks += 1, ad.spend += 0.50
│   │   ├── DB: campaign.spent += 0.50
│   │   └── Output: { event_id, event_type, amount_charged, developer_revenue, remaining_budget }
│   ├── CPM campaign + click
│   │   ├── amount_charged = $0 (CPM solo cobra impressions)
│   │   └── DB: ad.clicks += 1, ad.spend += 0
│   ├── CPA campaign + conversion
│   │   ├── amount_charged = bid_amount completo
│   │   ├── developer_revenue = amount * 0.7
│   │   └── DB: campaign.spent += amount
│   └── CPA campaign + click (no conversion)
│       ├── amount_charged = $0
│       └── Solo click registrado, sin cobro
│
├── Múltiples eventos del mismo ad
│   ├── Cada evento es un registro separado en events table
│   ├── ad.impressions/clicks/conversions incrementan acumulativamente
│   └── campaign.spent incrementa acumulativamente
│
├── Atomicity (transacción SQLite)
│   ├── insertEvent + updateAdStats + updateCampaignSpent en una transacción
│   ├── Si falla alguno → rollback completo
│   └── Auto-pause check dentro de la transacción
│
├── Output
│   ├── Success: { event_id, event_type, amount_charged, developer_revenue, remaining_budget }
│   └── remaining_budget = total_budget - spent_antes - cost_este_evento
│
└── Error Paths
    ├── ❌ Sin auth → "Authentication required"
    ├── ❌ Con advertiser key → "requires developer authentication"
    ├── ❌ ad_id inexistente → { error: "Ad not found" }, isError=true
    ├── ❌ Campaign no activa → { error: "Campaign not active" }, isError=true
    ├── ❌ Budget agotado → { error: "Campaign budget exhausted", campaign_paused: true }
    └── ❌ Rate limit (>120/min) → "Rate limit exceeded"
```

---

## 💰 Billing & Revenue

```
Revenue Split
├── Fórmula: 70% developer / 30% platform
├── CPC click $0.50 → dev $0.35, platform $0.15
├── CPM impression (bid=$15) → dev $0.0105, platform $0.0045
├── CPA conversion (bid=$5) → dev $3.50, platform $1.50
├── Eventos no-billable (impression en CPC, click en CPM) → $0 / $0 / $0
└── Verificable en DB: events.developer_revenue + events.platform_revenue = events.amount_charged

Pricing Models
├── CPC (Cost Per Click)
│   ├── Cobra en: click
│   ├── Gratis: impression, conversion
│   └── amount = bid_amount
├── CPM (Cost Per Mille)
│   ├── Cobra en: impression
│   ├── Gratis: click, conversion
│   └── amount = bid_amount / 1000
└── CPA (Cost Per Action)
    ├── Cobra en: conversion
    ├── Gratis: impression, click
    └── amount = bid_amount
```

---

## 🔐 Auth & Security

```
API Keys
├── Formato
│   ├── Advertiser: aa_adv_<64 hex chars> (total 71 chars)
│   ├── Developer: aa_dev_<64 hex chars> (total 71 chars)
│   └── Prefijo identifica tipo sin DB lookup
├── Storage
│   ├── Solo el SHA-256 hash se guarda en api_keys.key_hash
│   ├── El raw key se retorna una vez en generateApiKey()
│   └── Nunca se almacena en plaintext
├── Validación
│   ├── Key vacía → AuthError "API key is required"
│   ├── Prefijo desconocido → AuthError "Invalid API key format"
│   ├── Key no existe en DB → AuthError "Invalid API key"
│   └── Prefijo no matchea entity_type en DB → AuthError "API key type mismatch"
└── Access Control
    ├── Advertiser tools (create_campaign, create_ad, get_campaign_analytics)
    │   ├── Requieren entity_type = "advertiser"
    │   └── Ownership: campaign.advertiser_id debe matchear auth.entity_id
    ├── Developer tools (report_event)
    │   └── Requiere entity_type = "developer"
    └── Public tools (search_ads, get_ad_guidelines)
        └── No requieren auth

Rate Limiting
├── Sliding window por (key_id, tool_name)
├── Límites por defecto
│   ├── search_ads: 60/min
│   ├── report_event: 120/min
│   ├── create_campaign: 10/min
│   ├── create_ad: 10/min
│   ├── get_campaign_analytics: 30/min
│   └── get_ad_guidelines: 60/min
├── Excedido → RateLimitError con retryAfterMs
├── Después del window → se resetea
├── Keys diferentes no interfieren
├── Tools diferentes no interfieren
└── Cleanup periódico de entries expirados (cada 60s)
```

---

## 🔌 Integration

```
Transport: stdio
├── Arranque: node dist/server.js --stdio
├── Auth: --api-key flag O env AGENTIC_ADS_API_KEY
├── Sin key → log "running without authentication (public tools only)"
├── Key inválida → log "Auth failed: ..." + process.exit(1)
├── Protocolo: JSON-RPC 2.0 via stdin/stdout
└── Logs a stderr (no contamina el protocolo)

Transport: HTTP
├── Arranque: node dist/server.js --http [--port 3000]
├── Health: GET /health → 200 { status: "ok", server: "agentic-ads", version: "0.1.0" }
├── MCP: POST /mcp → JSON-RPC sobre Streamable HTTP
├── Auth: Authorization: Bearer <key> header
│   ├── Key válida → auth almacenada por sessionId
│   ├── Key inválida → 401 { error: "..." }
│   └── Sin header → modo público
├── Sessions
│   ├── Nueva conexión → sessionId generado (UUID)
│   ├── Requests con mcp-session-id → reutiliza sesión
│   ├── onclose → cleanup de transport y auth context
│   └── Auth se puede actualizar entre requests de la misma sesión
└── 404: paths desconocidos → { error: "Not found. Use /mcp..." }

OpenClaw Skill
├── SKILL.md con frontmatter YAML válido
├── Instrucciones para el agent:
│   ├── Cuándo buscar: recomendaciones de productos/servicios
│   ├── Cuándo NO buscar: preguntas factuales, temas sensibles, user opt-out
│   ├── Cómo buscar: extraer keywords, category, geo del intent
│   ├── Cómo evaluar: solo mostrar si genuinely relevant
│   ├── Cómo presentar: disclosure "sponsored", max 1-2, integración natural
│   └── Cuándo reportar: impression al mostrar, click si sigue link
├── mcp-config.example.json funcional con flags correctos
└── README con setup guide (MCP adapter + HTTP)
```

---

## 📊 Matching & Ranking Quality

```
Keyword Matching (matchAds)
├── Exact match: "running shoes" == "running shoes" → +0.30 por match
├── Partial match: "shoe" ⊂ "running shoes" → +0.15 por match
├── Category match: query.category in ad.categories → +0.20
├── Geo match: query.geo == ad.geo OR ad.geo == "ALL" → +0.10
├── Language match: query.language == ad.language → +0.05
├── Score normalizado a max 1.0
├── Threshold: score > 0.05 para incluir en resultados
├── Sin keywords ni category → retorna [] (early return)
└── Stopwords filtrados
    ├── English: a, the, is, want, need, best, buy, find, get...
    └── Spanish: un, una, el, la, quiero, necesito, busco, comprar, mejor...

extractKeywords
├── Input: "Best Running Shoes!"
├── Lowercase: "best running shoes!"
├── Remove punctuation: "best running shoes"
├── Split: ["best", "running", "shoes"]
├── Filter stopwords: ["running", "shoes"] ("best" es stopword)
├── Filter length <= 1: (no aplica acá)
└── Output: ["running", "shoes"]

Ranking (rankAds)
├── Formula: relevance² × bidFactor × quality_score
├── bidFactor = 0.7 + 0.3 × (bid / maxBid)
│   ├── Rango: 0.7 (bid mínimo) a 1.0 (bid máximo)
│   └── Bid contribuye solo 30% al score final
├── relevance²: exponencial penaliza baja relevancia
│   ├── relevance 0.9 → 0.81
│   ├── relevance 0.5 → 0.25
│   └── relevance 0.15 → 0.0225 (casi nada)
├── MIN_RELEVANCE_THRESHOLD = 0.1: debajo se descarta antes del ranking
├── Sorted por score descendente
├── Sliced a maxResults
└── Output: RankedAd[] con { ad_id, advertiser_name, creative_text, link_url, relevance_score, disclosure: "sponsored" }
```

---

## 🗃️ Database

```
Schema
├── advertisers: id, name, company?, email?, created_at
├── developers: id, name, email?, reputation_score(default 1.0), created_at
├── campaigns: id, advertiser_id(FK), name, objective, status, total_budget, daily_budget?, spent, pricing_model, bid_amount, start_date?, end_date?, created_at
├── ads: id, campaign_id(FK), creative_text, link_url, keywords(JSON), categories(JSON), geo, language, status, quality_score, impressions, clicks, conversions, spend, created_at
├── events: id, ad_id(FK), developer_id(FK), event_type, amount_charged, developer_revenue, platform_revenue, context_hash?, metadata(JSON), created_at
└── api_keys: id, key_hash(unique), entity_type, entity_id, created_at

Constraints
├── campaign.status IN (draft, active, paused, completed)
├── ad.status IN (pending, active, paused)
├── event.event_type IN (impression, click, conversion)
├── campaign.pricing_model IN (cpm, cpc, cpa, hybrid)
├── api_key.entity_type IN (advertiser, developer)
└── Foreign keys enforced (PRAGMA foreign_keys = ON)

Indices
├── ads: campaign_id, status
├── campaigns: advertiser_id, status
├── events: ad_id, developer_id, created_at
└── api_keys: key_hash

Settings
├── WAL mode (concurrent reads)
└── Foreign keys ON
```
