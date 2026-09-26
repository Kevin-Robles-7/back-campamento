-- ============================================================
--  Campamento IPUC Bosque Popular · esquema PostgreSQL
--  Pensado para Supabase (Postgres 15+).
--
--  Se ejecuta con: npm run db:migrate
--  Es idempotente: se puede correr varias veces sin romper nada.
-- ============================================================

-- ------------------------------------------------------------
--  Tipos enumerados
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transporte_persona') THEN
    CREATE TYPE transporte_persona AS ENUM ('bus', 'vehiculo_propio');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transporte_inscripcion') THEN
    CREATE TYPE transporte_inscripcion AS ENUM ('bus', 'vehiculo_propio', 'mixto');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_inscripcion') THEN
    CREATE TYPE estado_inscripcion AS ENUM ('borrador', 'activa', 'completada', 'anulada');
  END IF;

  -- C Cedula, E Cedula de extranjeria, T Tarjeta de identidad,
  -- P Pasaporte, R Registro civil, N NUIP (formato oficial 2025)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_documento') THEN
    CREATE TYPE tipo_documento AS ENUM ('CC', 'CE', 'TI', 'PA', 'RC', 'NUIP');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_documento_rep') THEN
    CREATE TYPE tipo_documento_rep AS ENUM ('CC', 'PA', 'PPT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sexo_persona') THEN
    CREATE TYPE sexo_persona AS ENUM ('F', 'M');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_pago') THEN
    CREATE TYPE tipo_pago AS ENUM ('completo', 'abono');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_persona') THEN
    CREATE TYPE estado_persona AS ENUM ('abono', 'completo');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'origen_datos') THEN
    CREATE TYPE origen_datos AS ENUM ('ia', 'ocr', 'manual');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_movimiento') THEN
    CREATE TYPE tipo_movimiento AS ENUM ('inicial', 'abono');
  END IF;
END
$$;

-- ------------------------------------------------------------
--  Configuracion / tarifas del campamento
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
  clave       VARCHAR(60)  PRIMARY KEY,
  valor       VARCHAR(255) NOT NULL,
  descripcion VARCHAR(255),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
--  Inscripciones
--  Agrupa un pago (comprobante) y 1..N personas.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inscripciones (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo            VARCHAR(20) NOT NULL UNIQUE,
  -- 'mixto' cuando las personas viajan de formas distintas.
  transporte        transporte_inscripcion NOT NULL DEFAULT 'bus',
  -- Informativo: con transporte mixto cada persona tiene su tarifa.
  valor_por_persona NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_a_pagar     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_pagado      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  saldo_pendiente   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estado            estado_inscripcion NOT NULL DEFAULT 'borrador',
  paso_actual       SMALLINT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inscripciones_estado ON inscripciones (estado);

-- ------------------------------------------------------------
--  Comprobantes de pago (imagen + datos extraidos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comprobantes (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inscripcion_id     BIGINT REFERENCES inscripciones (id) ON DELETE CASCADE,
  numero_transaccion VARCHAR(60),
  valor_enviado      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  banco_origen       VARCHAR(80),
  banco_destino      VARCHAR(80),
  llave_destino      VARCHAR(120),
  fecha_transaccion  TIMESTAMPTZ,
  archivo_nombre     VARCHAR(255),
  -- Clave del objeto en el almacenamiento (Supabase Storage / R2 / disco).
  archivo_ruta       VARCHAR(255),
  archivo_mime       VARCHAR(100),
  origen_datos       origen_datos NOT NULL DEFAULT 'manual',
  datos_crudos       JSONB,
  verificado         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No es UNIQUE: cada intento de carga queda registrado para auditoria.
-- La regla "una transaccion paga una sola inscripcion" se valida en la app.
CREATE INDEX IF NOT EXISTS idx_comprobantes_transaccion ON comprobantes (numero_transaccion);
CREATE INDEX IF NOT EXISTS idx_comprobantes_inscripcion ON comprobantes (inscripcion_id);

-- ------------------------------------------------------------
--  Documentos de soporte del consentimiento (PDF o Word)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documentos_consentimiento (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  archivo_nombre VARCHAR(255) NOT NULL,
  archivo_ruta   VARCHAR(255) NOT NULL,
  archivo_mime   VARCHAR(120) NOT NULL,
  tamano_bytes   INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
--  Personas inscritas
--  Campos alineados con «FORMATO DE INSCRIPCION 2025.xlsx»
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personas (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inscripcion_id     BIGINT NOT NULL REFERENCES inscripciones (id) ON DELETE CASCADE,
  primer_nombre      VARCHAR(80)  NOT NULL,
  primer_apellido    VARCHAR(80)  NOT NULL,
  nombre_completo    VARCHAR(160) NOT NULL,
  tipo_documento     tipo_documento NOT NULL DEFAULT 'CC',
  documento          VARCHAR(30)  NOT NULL UNIQUE,
  fecha_expedicion   DATE,
  telefono           VARCHAR(30)  NOT NULL,
  correo             VARCHAR(160),
  fecha_nacimiento   DATE,
  edad               SMALLINT,
  sexo               sexo_persona,
  eps                VARCHAR(120),
  nombre_acompanante VARCHAR(160),
  -- El transporte es por persona: unos pueden ir en bus y otros en
  -- vehiculo propio dentro de la misma inscripcion.
  transporte         transporte_persona NOT NULL DEFAULT 'bus',
  tipo_pago          tipo_pago NOT NULL DEFAULT 'completo',
  valor_asignado     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  valor_pagado       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  saldo_pendiente    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estado             estado_persona NOT NULL DEFAULT 'abono',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personas_inscripcion ON personas (inscripcion_id);

-- ------------------------------------------------------------
--  Pagos / abonos aplicados a una inscripcion
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inscripcion_id BIGINT NOT NULL REFERENCES inscripciones (id) ON DELETE CASCADE,
  persona_id     BIGINT REFERENCES personas (id) ON DELETE SET NULL,
  comprobante_id BIGINT REFERENCES comprobantes (id) ON DELETE SET NULL,
  valor          NUMERIC(12, 2) NOT NULL,
  tipo           tipo_movimiento NOT NULL DEFAULT 'abono',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_inscripcion ON pagos (inscripcion_id);

-- ------------------------------------------------------------
--  Consentimiento para menores de edad
--  Refleja «CONSENTIMIENTO INFORMADO SEPRI D 28.docx»
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consentimientos_menores (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id              BIGINT NOT NULL UNIQUE REFERENCES personas (id) ON DELETE CASCADE,
  documento_id            BIGINT REFERENCES documentos_consentimiento (id) ON DELETE SET NULL,
  departamento_municipio  VARCHAR(160),
  fecha_diligenciamiento  DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre_representante    VARCHAR(160) NOT NULL,
  tipo_documento_rep      tipo_documento_rep NOT NULL DEFAULT 'CC',
  documento_representante VARCHAR(30) NOT NULL,
  congregacion            VARCHAR(160),
  destino                 VARCHAR(160),
  telefono_emergencia     VARCHAR(30) NOT NULL,
  acepta_consentimiento   BOOLEAN NOT NULL DEFAULT FALSE,
  firma_base64            TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
--  updated_at automatico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION tocar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inscripciones_updated ON inscripciones;
CREATE TRIGGER trg_inscripciones_updated BEFORE UPDATE ON inscripciones
  FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();

DROP TRIGGER IF EXISTS trg_personas_updated ON personas;
CREATE TRIGGER trg_personas_updated BEFORE UPDATE ON personas
  FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();

DROP TRIGGER IF EXISTS trg_configuracion_updated ON configuracion;
CREATE TRIGGER trg_configuracion_updated BEFORE UPDATE ON configuracion
  FOR EACH ROW EXECUTE FUNCTION tocar_updated_at();

-- ------------------------------------------------------------
--  Datos iniciales
-- ------------------------------------------------------------
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('tarifa_bus',             '195000', 'Valor por persona viajando en bus'),
  ('tarifa_vehiculo_propio', '180000', 'Valor por persona en vehiculo propio'),
  ('abono_minimo',           '20000',  'Abono minimo permitido por persona'),
  ('llave_pago',             '@Plata3143817689', 'Unica llave Bre-B autorizada'),
  ('correo_destino',         'campamentobp@gmail.com', 'Correo de contacto'),
  ('llaves_validas',         '@Plata3143817689', 'Unico destino aceptado del pago'),
  ('validar_llave',          '1', 'Si es 1 se rechaza el pago enviado a otra cuenta'),
  ('validar_fecha',          '1', 'Si es 1 se valida la vigencia del comprobante'),
  ('dias_vigencia_comprobante', '30', 'Antiguedad maxima aceptada, en dias'),
  ('minutos_tolerancia_fecha',  '120', 'Margen por diferencias de reloj'),
  ('fecha_evento',           '7 y 8 de noviembre', 'Fecha del campamento'),
  ('lugar_evento',           'Finca Agua Viva', 'Lugar del campamento'),
  ('whatsapp',               '573143817689', 'WhatsApp de contacto')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion;
