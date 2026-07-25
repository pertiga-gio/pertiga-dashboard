# Arquitectura Técnica — Pértiga Dashboard

## Visión general

Dashboard analítico para monitorear un bot de WhatsApp inmobiliario en producción. Construido con **Node.js puro** (sin framework) y **vanilla JavaScript** (sin React/Vue/Angular). Usa PostgreSQL (via Supabase) con pgvector para búsqueda semántica.

## Flujo de datos completo

```mermaid
graph TD
    A[Cliente WhatsApp] -->|mensaje| B[Meta Cloud API]
    B -->|webhook| C[Cloudflare Tunnel]
    C --> D[Proxy Node.js 8090]
    D -->|routing by phone_number_id| E[n8n Workflow]
    
    E -->|Stage 1: LLM extraction| F[Ollama nemotron-3-super]
    E -->|Stage 2: Semantic search| G[PostgREST RPC]
    G -->|pgvector cosine similarity| H[(PostgreSQL)]
    E -->|Stage 3: Response| I[Ollama minimax-m3]
    E -->|Persist| J[bot_conversations table]
    E -->|Schedule| K[Google Calendar API]
    
    E -->|Update lead| L[leads table]
    E -->|Create appointment| M[appointments table]
    
    N[Dashboard SPA] -->|fetch /api/*| O[server.js 3002]
    O -->|proxy + API key| P[PostgREST 3000]
    P --> H
    O -->|generate embedding| Q[Ollama bge-m3]
    Q -->|save vector| H
    
    style A fill:#25D366,color:#fff
    style E fill:#FF675C,color:#fff
    style H fill:#336791,color:#fff
    style N fill:#0056b3,color:#fff
    style Q fill:#6E56CF,color:#fff
```

## Componentes

### 1. Dashboard Frontend (`index.html`)
- **Tipo**: SPA (Single Page Application) vanilla JS
- **Tamaño**: ~2800 líneas (HTML + CSS + JS embebido)
- **Sin framework**: no React, no Vue, no Angular
- **Secciones**: Resumen, Monitor en Vivo, Leads, Conversaciones, Inventario
- **Temas**: Light/Dark con persistencia en localStorage
- **Responsive**: sidebar (desktop) + bottom-nav (móvil)

### 2. Dashboard Backend (`server.js`)
- **Tipo**: Servidor HTTP custom con el módulo `http` de Node.js
- **Sin Express, sin Fastify**: implementación directa
- **Endpoints**:
  - `POST /login` → autenticación SHA-256 + cookie
  - `GET /logout` → cerrar sesión
  - `GET /` → servir `index.html` con API key inyectada
  - `POST /embed-property` → generar embedding via Ollama
  - `POST /embed-missing` → batch embedding (50 concurrente)
  - `ALL /api/*` → proxy a PostgREST con API key

### 3. Búsqueda Semántica Híbrida

```mermaid
flowchart LR
    A[Query del usuario] --> B[Generar embedding<br/>bge-m3 1024-dim]
    B --> C[PostgREST RPC<br/>buscar_propiedades_hibrido]
    C --> D{Filtros SQL duros}
    D -->|tipo, zona, ciudad,<br/>operación, precio, rooms| E[WHERE clause]
    D -->|barrio| F[ILIKE fuzzy match]
    C --> G[Cosine similarity<br/>vs property embeddings]
    E --> H[Combinar]
    F --> H
    G --> H
    H --> I[ORDER BY similarity DESC]
    I --> J[Boost por amenidades<br/>no filtro duro]
    J --> K[LIMIT match_count]
    K --> L[Resultados finales]
    
    style B fill:#6E56CF,color:#fff
    style C fill:#336791,color:#fff
    style G fill:#6E56CF,color:#fff
```

#### ¿Por qué híbrida?

| Búsqueda pura (vector) | Filtros puros (SQL) | Híbrida ✓ |
|----------------------|--------------------|-----------|
| Encuentra conceptos similares | Filtra exactos | Combina ambos |
| No respeta filtros duros | No entiende semántica | Respeta filtros + ordena por similitud |
| "apto cerca al parque" → matchea | "3 hab, Cali, < $300M" → exacto | "3 hab, Cali, < $300M, apto cerca al parque" |

### 4. Generación de Embeddings

```mermaid
sequenceDiagram
    participant D as Dashboard
    participant S as server.js
    participant O as Ollama (bge-m3)
    participant P as PostgREST
    participant DB as PostgreSQL
    
    Note over D: Usuario hace clic en "Generar embedding"
    D->>S: POST /embed-property {id, searchText}
    S->>O: POST /api/embed {model: bge-m3, input: searchText}
    O-->>S: {embeddings: [[0.1, 0.2, ... 1024 dims]]}
    S->>P: PATCH /properties?id=eq.{id} {embedding: [...]}
    P->>DB: UPDATE properties SET embedding = [...]
    P-->>S: 204 No Content
    S-->>D: {ok: true}
    
    Note over D: Batch: POST /embed-missing
    D->>S: POST /embed-missing
    S->>P: GET /properties?embedding=is.null&limit=50
    P-->>S: [{id, title, neighborhood, ...}]
    S->>O: POST /api/embed (batch de 50)
    O-->>S: {embeddings: [[...], [...], ...]}
    loop Cada propiedad
        S->>P: PATCH /properties?id=eq.{id} {embedding: [...]}
    end
    S-->>D: {ok: true, updated: 50}
```

## Optimizaciones de performance

### Frontend
- **Polling rate**: Monitor en vivo cada 5s (configurable)
- **Date filtering**: Filtrado en cliente (no re-fetch del server)
- **Chart rendering**: CSS puro, sin librerías de gráficos
- **Table pagination**: Implementación custom sin dependencias

### Backend
- **Batch embedding**: 50 propiedades concurrente via `UrlFetchApp.fetchAll`
- **Proxy con timeout**: 30s timeout en llamadas a Ollama/PostgREST
- **Rate limiting**: Map en memoria, limpieza periódica
- **Session cleanup**: Map en memoria con expiración 24h

### Base de datos
- **IVFFlat index** para búsqueda vectorial (lists=100)
- **B-tree indexes** en city, zona, operation_type, status
- **Índice compuesto** en bot_conversations(phone, created_at DESC)
- **RPC function** en SQL (no JS) para máxima performance
