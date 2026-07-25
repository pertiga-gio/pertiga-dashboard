# 🏗️ Pértiga Dashboard — Real Estate AI Analytics

**Analytics dashboard for AI-powered WhatsApp real estate bot — Pértiga Soluciones**

A real-time analytics dashboard for monitoring WhatsApp conversations, lead scoring, property inventory, and AI bot performance. Built as part of the **Pértiga MVP** — an AI-powered real estate assistant that handles property search and scheduling via WhatsApp.

![License](https://img.shields.io/badge/license-proprietary-orange)
![Platform](https://img.shields.io/badge/platform-Node.js-green)
![Status](https://img.shields.io/badge/status-production-success)
![Language](https://img.shields.io/badge/language-JavaScript-yellow)
![Database](https://img.shields.io/badge/database-PostgreSQL-blue)

---

## 🎯 Context

**Pértiga Soluciones SAS** is an AI automation company. One of its products is a **WhatsApp real estate bot** ("Inmobiliaria Puerta") that serves clients automatically: searches properties, schedules visits, and qualifies leads.

This dashboard is the **internal tool** that allows the team to monitor and manage the bot in production. It's not a customer-facing product — it's the team's operational tool.

## ✅ What It Does

### 📊 Summary Panel
- **Real-time KPIs**: unique users, total messages, leads, conversion rate
- **Activity charts**: messages and leads per day (7d / 30d / 90d)
- **Conversion funnel**: Conversations → Leads → Handoffs → Visits scheduled
- **Average bot response time**

### 📡 Live Monitor
- **Real-time conversation streaming** (polling-based)
- Configurable auto-refresh (on/off)
- Filter by lead status (hot/warm/cold)
- WhatsApp webhook status indicator (Meta Cloud API)

### 📋 Leads
- **Automatic lead scoring**: `new` → `cold` → `warm` → `hot`
- Hot leads polling with visual notification (🔥)
- Saved preferences: neighborhood, operation, property type, budget
- Conversation history per lead
- Manual editing of scores and notes

### 💬 Conversations
- Full message history by phone number
- Search by phone number
- Per-phone metrics: message count, properties mentioned, last interaction
- Top 5 most-mentioned properties

### 🏠 Property Inventory
- Full CRUD: create, edit, delete properties
- **289 properties** with vector embeddings
- Filters by city, zone, type, status
- Pagination and CSV export
- Bulk JSON import
- **Embedding generation** (individual + batch) via Ollama
- Status updates (available / reserved / sold)

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        DASHBOARD (Port 3002)                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  index.html — Single Page App (Vanilla JS, 2800+ lines)    │ │
│  │  • Dashboard with KPIs, charts, funnel                      │ │
│  │  • Live monitor (5s polling)                                │ │
│  │  • Property CRUD + embedding management                     │ │
│  │  • Date filters, sort/pagination tables                     │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  server.js — Node.js HTTP server (530 lines)                │ │
│  │  • Session auth (sha256 + cookie)                           │ │
│  │  • Rate limiting (5 attempts / 15 min lockout)             │ │
│  │  • PostgREST proxy (injects API key server-side)            │ │
│  │  • Embedding generation via Ollama (bge-m3)                │ │
│  │  • Batch embedding for properties without vectors           │ │
│  └──────────┬───────────────────────────────┬──────────────────┘ │
└─────────────┼───────────────────────────────┼────────────────────┘
              │                               │
              ▼                               ▼
┌──────────────────────────┐    ┌─────────────────────────────────┐
│  PostgREST (Port 3000)   │    │  Ollama (Port 11434)            │
│  • REST API over         │    │  • Model: bge-m3 (embeddings)   │
│    PostgreSQL            │    │  • Generates 1024-dim vectors   │
│  • Tables: properties,  │    │  • Used for semantic search      │
│    leads, bot_convo,     │    │    on property inventory          │
│    appointments          │    └─────────────────────────────────┘
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase / PostgreSQL                                   │
│  Tables:                                                 │
│  • properties (28 cols, incl. embedding vector(1024))    │
│  • leads (lead_score, budget, preferences)              │
│  • bot_conversations (role, content,timestamps)         │
│  • appointments (scheduled visits)                      │
│  • buscar_propiedades_hibrido (RPC function)            │
│    → hybrid search: semantic embedding + SQL filters    │
└──────────────────────────────────────────────────────────┘
```

### WhatsApp bot data flow (context)

The dashboard consumes data generated by the **WhatsApp bot** running in parallel:

```
WhatsApp Client
   │
   ▼
Meta Cloud API → Cloudflare Tunnel → Node.js Proxy (8090)
   │
   ▼
n8n Workflow (9QZcTKil0MZNgBhQ)
   ├── Stage 1: Filter extraction (LLM via Ollama)
   ├── Stage 2: Semantic search (PostgREST RPC + bge-m3 embeddings)
   ├── Conversational response (LLM via Ollama)
   ├── Persistence (bot_conversations in PostgreSQL)
   └── Scheduling (Google Calendar API)
   │
   ▼
PostgreSQL (leads, conversations, appointments)
   │
   ▼
Dashboard (this project) ← operational consumption and management
```

## 🔧 Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Vanilla HTML/CSS/JavaScript (no framework) | SPA with tabs, charts, tables, modals |
| **Backend** | Node.js HTTP server (no framework) | Auth, API proxy, embedding management |
| **Database** | PostgreSQL (via Supabase) | properties, leads, conversations, appointments |
| **REST API** | PostgREST | Auto-generated REST CRUD over PostgreSQL |
| **Vector embeddings** | bge-m3 (via Ollama) | 1024-dim embeddings for semantic search |
| **Authentication** | sha256 + session cookie | Login with rate limiting and lockout |
| **Bot LLM** | Ollama + cloud models | Filter extraction and conversational response |

## 🛠️ Demonstrated Technical Competencies

### Frontend (Vanilla JS, no framework)
- **SPA architecture** with dynamic tab/section system
- **Custom charts** (bars, funnel) built from scratch with CSS/flexbox
- **Polling system** with configurable auto-refresh
- **Advanced filters**: date range (7d/30d/90d/custom), search, sort
- **Table pagination** implemented manually
- **CSV export** of inventory
- **Light/Dark theme** with localStorage persistence
- **Responsive design** (sidebar + bottom-nav on mobile)

### Backend
- **Custom HTTP server** (Node `http` module, no Express)
- **Authentication system** with SHA-256, cookie sessions, 24h expiry
- **Rate limiting**: 5 attempts → 15 min lockout (in-memory map)
- **Reverse proxy**: injects API key server-side (never exposed to client)
- **Ollama integration** for embedding generation (batch + individual)
- **PostgREST proxy** with retries and timeout handling
- **Batch processing** of embeddings (50 properties concurrent)

### Database & Semantic Search
- **Relational schema** for real estate CRM (properties, leads, conversations, appointments)
- **Hybrid search** (PostgreSQL RPC): combine semantic embeddings + hard SQL filters
- **289 embeddings** generated with bge-m3 (1024 dimensions)
- **Lead scoring** persistent with 4 levels (new/cold/warm/hot)
- **Vector similarity search** with pgvector

### External API Integrations
- **Meta Cloud API** (WhatsApp Business) — webhook reception
- **Ollama API** — embedding generation and LLM
- **PostgREST** — CRUD over PostgreSQL
- **Google Calendar API** — visit scheduling (via bot, visible in dashboard)

### DevOps & Infrastructure
- **Nginx reverse proxy** with SSL/TLS (Let's Encrypt)
- **Systemd services** for persistent processes
- **Docker Compose** for the stack (Supabase, n8n)
- **Cloudflare Tunnel** for Meta webhooks
- **Logging** and webhook status monitoring

## 📊 Database Schema (simplified)

```sql
-- Properties with vector embeddings for semantic search
properties (
  id UUID PRIMARY KEY,
  title TEXT, property_type TEXT, operation_type TEXT,
  neighborhood TEXT, city TEXT, price BIGINT,
  rooms INT, bathrooms INT, area_sqm INT,
  tiene_piscina BOOL, tiene_gimnasio BOOL, ...  -- 20+ amenities
  embedding VECTOR(1024),  -- bge-m3
  status TEXT DEFAULT 'disponible'
)

-- Leads with automatic scoring
leads (
  id UUID PRIMARY KEY,
  phone_number TEXT UNIQUE,
  name TEXT, email TEXT,
  lead_score TEXT CHECK IN ('new','cold','warm','hot'),
  budget_min BIGINT, budget_max BIGINT,
  preferred_neighborhood TEXT, preferred_property_type TEXT,
  preferred_operation TEXT CHECK IN ('venta','arriendo'),
  notes TEXT, last_contact_at TIMESTAMPTZ
)

-- WhatsApp bot conversations
bot_conversations (
  id UUID PRIMARY KEY,
  phone TEXT, role TEXT CHECK IN ('user','assistant'),
  content TEXT, created_at TIMESTAMPTZ
)

-- RPC function: hybrid semantic search
-- Combines embeddings + SQL filters:
--   - Hard filter by type, zone, city, operation
--   - Sort by embedding cosine similarity
--   - Amenity boost (not hard filter)
buscar_propiedades_hibrido(
  query_embedding VECTOR(1024),
  match_threshold FLOAT, match_count INT,
  filtro_zona TEXT, filtro_operacion TEXT,
  filtro_tipo TEXT, filtro_ciudad TEXT,
  precio_maximo BIGINT, filtro_rooms_min INT,
  filtro_barrio TEXT, ...  -- 12 amenity filters
)

-- Scheduled visits (by WhatsApp bot)
appointments (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  property_id UUID REFERENCES properties(id),
  scheduled_at TIMESTAMPTZ,
  status TEXT CHECK IN ('scheduled','confirmed','cancelled','completed')
)
```

## 📁 Repository Structure

```
pertiga-dashboard/
├── README.md
├── README.en.md
├── LICENSE
├── src/
│   ├── server.js              # Node.js backend (skeleton)
│   └── index.html             # Frontend SPA (skeleton)
└── docs/
    ├── arquitectura.md        # Technical details
    └── schema.sql             # Simplified DB schema
```

> ⚠️ **Note on source code**: As this is an active commercial product, the full source code is not published. Files in `src/` are representative skeletons showing the architecture and patterns used, but do not include the full implementation.

## ⚠️ Notes

- This dashboard is **part of the Pértiga product** and is in **active production**
- The associated WhatsApp bot uses Meta Cloud API (WhatsApp Business account)
- Property data belongs to **Inmobiliaria Puerta**, a Pértiga client
- Full source code is NOT published as it is a commercial product

## 🔗 Related Links

- **Public site**: https://pertigasoluciones.com
- **Other public project**: [Manualito en Daruma](https://github.com/pertiga-gio/manualito-en-daruma) — job functions manual search

## 👤 Author

Developed by **Giovanni Sánchez Soto** — June-July 2026

Pértiga Soluciones SAS — AI Automation.
