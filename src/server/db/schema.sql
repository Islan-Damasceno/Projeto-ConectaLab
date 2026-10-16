-- Configuração de Performance e Integridade para Inicialização do SQLite
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Tabela de Usuários (Alunos e Administradores)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ra TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'ADMIN')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Tabela de Armários Inteligentes (Pontos por Bloco)
CREATE TABLE IF NOT EXISTS lockers (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    building_location TEXT NOT NULL,
    is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Tabela de Objetos do Catálogo (SKUs)
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('EXATAS', 'SAUDE', 'ENERGIA')),
    description TEXT NOT NULL,
    hourly_price_cents INTEGER NOT NULL CHECK (hourly_price_cents > 0),
    daily_price_cents INTEGER NOT NULL CHECK (daily_price_cents > 0),
    requires_preparation INTEGER NOT NULL DEFAULT 0 CHECK (requires_preparation IN (0, 1)),
    image_url TEXT
);

-- 4. Tabela de Portas Numeradas (Vínculo 1:1 com Item - RN01)
CREATE TABLE IF NOT EXISTS doors (
    id TEXT PRIMARY KEY,
    locker_id TEXT NOT NULL REFERENCES lockers(id) ON DELETE CASCADE,
    door_number INTEGER NOT NULL CHECK (door_number > 0),
    item_id TEXT UNIQUE REFERENCES items(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (
        status IN (
            'AVAILABLE',
            'RESERVED',
            'AWAITING_PICKUP',
            'OCCUPIED_RENTED',
            'IN_PREPARATION',
            'MAINTENANCE'
        )
    ),
    lock_state TEXT NOT NULL DEFAULT 'LOCKED' CHECK (lock_state IN ('LOCKED', 'UNLOCKED')),
    current_rental_id TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (locker_id, door_number)
);

-- 5. Tabela de Locações / Reservas
CREATE TABLE IF NOT EXISTS rentals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    locker_id TEXT NOT NULL REFERENCES lockers(id),
    door_id TEXT NOT NULL REFERENCES doors(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    plan_type TEXT NOT NULL CHECK (plan_type IN ('HOURLY', 'DAILY')),
    duration_units INTEGER NOT NULL CHECK (duration_units >= 1),
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
    status TEXT NOT NULL DEFAULT 'AWAITING_PAYMENT' CHECK (
        status IN (
            'CREATED',
            'AWAITING_PAYMENT',
            'PAID_READY_FOR_PICKUP',
            'IN_USE',
            'AWAITING_RETURN_CLOSE',
            'COMPLETED',
            'CANCELLED'
        )
    ),
    cancel_reason TEXT CHECK (
        cancel_reason IS NULL OR cancel_reason IN (
            'EXPIRED_TTL',
            'ISSUE_REPORTED',
            'USER_ABORT',
            'ADMIN_FORCE'
        )
    ),
    issue_notes TEXT,
    reservation_expires_at TEXT NOT NULL,
    paid_at TEXT,
    first_unlocked_at TEXT,
    picked_up_at TEXT,
    expected_return_at TEXT,
    returned_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 6. Tabela de Pagamentos (PIX Mock)
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    rental_id TEXT NOT NULL UNIQUE REFERENCES rentals(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    method TEXT NOT NULL DEFAULT 'PIX_MOCK' CHECK (method IN ('PIX_MOCK')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN ('PENDING', 'PAID', 'REFUNDED', 'EXPIRED')
    ),
    pix_copy_paste TEXT NOT NULL,
    pix_qr_svg TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 7. Tabela de Auditoria e Telemetria das Portas
CREATE TABLE IF NOT EXISTS door_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    door_id TEXT NOT NULL REFERENCES doors(id) ON DELETE CASCADE,
    rental_id TEXT REFERENCES rentals(id) ON DELETE SET NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'UNLOCK_PICKUP',
            'UNLOCK_RETURN',
            'MASTER_UNLOCK',
            'DOOR_OPENED_ACK',
            'DOOR_CLOSED_PICKUP_COMPLETE',
            'DOOR_CLOSED_RETURN_COMPLETE',
            'STATUS_CHANGE'
        )
    ),
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Índices para Consultas em Tempo Real e Rotina de Expiração TTL
CREATE INDEX IF NOT EXISTS idx_doors_locker_status ON doors(locker_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_user_status ON rentals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_ttl ON rentals(status, reservation_expires_at);
CREATE INDEX IF NOT EXISTS idx_door_events_door_created ON door_events(door_id, created_at DESC);
