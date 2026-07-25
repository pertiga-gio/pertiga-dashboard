-- Pértiga Dashboard — Simplified Database Schema
-- This is a simplified version for documentation purposes.
-- The full schema includes additional columns, constraints, and indexes.

-- Properties with vector embeddings for semantic search
CREATE TABLE properties (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT        NOT NULL,
    property_type   TEXT        CHECK (property_type IN ('apartamento','casa','oficina','local','apartaestudio','edificio','terreno','finca')),
    operation_type  TEXT        CHECK (operation_type IN ('venta','arriendo')),
    neighborhood    TEXT,
    city            TEXT        DEFAULT 'Bogotá',
    price           BIGINT,     -- in COP
    rooms           INTEGER,
    bathrooms       INTEGER,
    area_sqm        INTEGER,
    description     TEXT,
    features        JSONB       DEFAULT '{}',
    images          JSONB       DEFAULT '[]',
    url             TEXT,      -- listing URL
    
    -- 20+ amenity boolean flags
    tiene_piscina           BOOL DEFAULT false,
    tiene_gimnasio          BOOL DEFAULT false,
    tiene_ascensor          BOOL DEFAULT false,
    tiene_parqueadero       BOOL DEFAULT false,
    tiene_porteria          BOOL DEFAULT false,
    tiene_seguridad_24h     BOOL DEFAULT false,
    tiene_juegos_infantiles BOOL DEFAULT false,
    tiene_salon_social      BOOL DEFAULT false,
    tiene_zona_bbq          BOOL DEFAULT false,
    tiene_cancha            BOOL DEFAULT false,
    tiene_balcon            BOOL DEFAULT false,
    tiene_jardin            BOOL DEFAULT false,
    tiene_deposito          BOOL DEFAULT false,
    tiene_cocina_integral  BOOL DEFAULT false,
    tiene_calentador        BOOL DEFAULT false,
    tiene_cuarto_util       BOOL DEFAULT false,
    tiene_estudio           BOOL DEFAULT false,
    
    -- Vector embedding for semantic search (bge-m3, 1024 dimensions)
    embedding       VECTOR(1024),
    zona           TEXT,
    status         TEXT DEFAULT 'disponible' CHECK (status IN ('disponible','reservado','vendido')),
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Leads with automatic scoring
CREATE TABLE leads (
    id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number            TEXT    NOT NULL UNIQUE,
    name                    TEXT,
    email                   TEXT,
    lead_score              TEXT    DEFAULT 'nuevo' CHECK (lead_score IN ('nuevo','frio','tibio','caliente')),
    budget_min              BIGINT,
    budget_max              BIGINT,
    preferred_neighborhood  TEXT,
    preferred_property_type TEXT,
    preferred_operation     TEXT    CHECK (preferred_operation IN ('venta','arriendo')),
    rooms_needed            INTEGER,
    notes                   TEXT,
    last_contact_at         TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- WhatsApp bot conversations
CREATE TABLE bot_conversations (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       TEXT        NOT NULL,
    role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Scheduled visits (created by WhatsApp bot)
CREATE TABLE appointments (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID    NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    property_id     UUID    REFERENCES properties(id) ON DELETE SET NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          TEXT    DEFAULT 'agendada' CHECK (status IN ('agendada','confirmada','cancelada','completada')),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- RPC function: hybrid semantic search
-- Combines vector similarity (pgvector) with SQL filters
-- This is the core search function used by the WhatsApp bot
CREATE OR REPLACE FUNCTION buscar_propiedades_hibrido(
    query_embedding     VECTOR(1024),
    match_threshold     FLOAT DEFAULT 0.15,
    match_count         INT    DEFAULT 20,
    filtro_zona         TEXT   DEFAULT NULL,
    filtro_operacion    TEXT   DEFAULT NULL,
    filtro_tipo         TEXT   DEFAULT NULL,
    filtro_ciudad       TEXT   DEFAULT NULL,
    precio_maximo       BIGINT DEFAULT NULL,
    filtro_rooms_min    INT    DEFAULT NULL,
    filtro_barrio       TEXT   DEFAULT NULL,
    -- 12 amenity filters (NULL = ignore, true = must have, false = must not have)
    filtro_piscina      BOOL   DEFAULT NULL,
    filtro_gimnasio     BOOL   DEFAULT NULL,
    filtro_ascensor     BOOL   DEFAULT NULL,
    filtro_parqueadero  BOOL   DEFAULT NULL,
    filtro_porteria     BOOL   DEFAULT NULL,
    filtro_zona_bbq     BOOL   DEFAULT NULL,
    filtro_salon_social BOOL   DEFAULT NULL,
    filtro_juegos_infantiles BOOL DEFAULT NULL,
    filtro_cancha       BOOL   DEFAULT NULL,
    filtro_balcon       BOOL   DEFAULT NULL,
    filtro_jardin       BOOL   DEFAULT NULL
)
RETURNS TABLE (
    id UUID, title TEXT, neighborhood TEXT, city TEXT, zona TEXT,
    property_type TEXT, operation_type TEXT, price BIGINT,
    rooms INT, bathrooms INT, area_sqm INT,
    similarity FLOAT,
    -- amenity flags
    tiene_piscina BOOL, tiene_gimnasio BOOL, -- ... etc
    url TEXT
) AS $$
    -- Implementation: 
    -- 1. Filter by hard SQL constraints (tipo, zona, ciudad, operación, precio, rooms)
    -- 2. Filter by barrio using ILIKE (fuzzy match)
    -- 3. Compute cosine similarity with query_embedding
    -- 4. Filter by match_threshold
    -- 5. Order by similarity DESC
    -- 6. Limit to match_count
    -- Amenities are NOT hard filters — they're used as ranking boost instead
$$ LANGUAGE SQL STABLE;

-- Indexes for performance
CREATE INDEX idx_properties_embedding ON properties USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_properties_city ON properties (city);
CREATE INDEX idx_properties_zona ON properties (zona);
CREATE INDEX idx_properties_operation ON properties (operation_type);
CREATE INDEX idx_properties_status ON properties (status);
CREATE INDEX idx_leads_phone ON leads (phone_number);
CREATE INDEX idx_bot_convos_phone ON bot_conversations (phone);
CREATE INDEX idx_bot_convos_created ON bot_conversations (created_at DESC);
