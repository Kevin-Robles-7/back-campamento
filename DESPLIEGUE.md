# Despliegue · Campamento IPUC Bosque Popular

Todo gratuito, sin AWS.

| Pieza | Servicio | Plan gratuito |
| --- | --- | --- |
| Frontend Angular | Netlify | Sin costo |
| API Node/Express | Render | 750 h/mes |
| Base de datos PostgreSQL | Supabase | 500 MB |
| Comprobantes y documentos | Supabase Storage | 1 GB |

> **Nunca pegues credenciales en el código ni en el repositorio.** Van en el
> panel de cada servicio y, en local, en `backend/.env` (que está ignorado por git).

---

## 1. Supabase · base de datos y almacenamiento

1. Crea un proyecto en [supabase.com](https://supabase.com). Guarda la contraseña de la base: no se vuelve a mostrar.
2. **Storage → New bucket**, nombre `comprobantes`. Déjalo **privado**: los comprobantes traen nombres y datos bancarios, y la aplicación los sirve con enlaces temporales firmados.
3. **Project Settings → Database → Connection string → URI.** Copia la cadena del **pooler (puerto 6543)**, no la del puerto 5432. Render abre y cierra conexiones y el pooler es lo que aguanta eso.
4. **Project Settings → Storage → S3 Connection.** Ahí está el endpoint (`https://<ref>.supabase.co/storage/v1/s3`) y la región. Crea un *access key*: te da un id y un secreto.

### Crear las tablas

En tu máquina, con `backend/.env` apuntando a Supabase:

```bash
cd backend
cp .env.example .env     # pega DATABASE_URL
npm ci
npm run db:migrate
```

Debe listar las siete tablas y los trece parámetros de configuración. El script es
idempotente: puedes repetirlo sin perder datos.

---

## 2. Cuenta de Gemini para leer los comprobantes

El OCR local (Tesseract) usa demasiada memoria para los 512 MB del plan gratuito
de Render. En producción se usa Gemini, que el código ya soporta.

Saca una API key gratuita en [Google AI Studio](https://aistudio.google.com/apikey).

Si prefieres no usar ningún servicio externo, pon `OCR_PROVIDER=manual`, pero
entonces ningún comprobante se validará automáticamente y la inscripción queda
bloqueada, porque el sistema solo acepta datos leídos de la imagen.

---

## 3. GitHub

Render y Netlify despliegan desde un repositorio.

```bash
cd /ruta/del/proyecto
git init
git add .
git commit -m "Inscripciones del campamento"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/campamento.git
git push -u origin main
```

Verifica que `.env` **no** aparezca en `git status`. Si aparece, detente y revisa
el `.gitignore`.

---

## 4. Render · la API

1. **New → Blueprint**, selecciona el repositorio. Render lee `render.yaml`.
2. Completa las variables marcadas como secretas:

| Variable | De dónde sale |
| --- | --- |
| `DATABASE_URL` | Supabase → Database → Connection string (puerto 6543) |
| `S3_ENDPOINT` | Supabase → Storage → S3 Connection |
| `S3_ACCESS_KEY_ID` | El access key que creaste |
| `S3_SECRET_ACCESS_KEY` | El secreto del mismo access key |
| `GEMINI_API_KEY` | Google AI Studio |
| `CORS_ORIGIN` | La URL de Netlify, por ejemplo `https://campamento-bp.netlify.app` |

3. Despliega y abre `https://TU-API.onrender.com/health`. Debe responder:

```json
{ "ok": true, "db": "up", "almacenamiento": { "ok": true, "driver": "s3", "bucket": "comprobantes" } }
```

Si `almacenamiento.ok` es `false`, el mensaje te dice qué variable falta.

---

## 5. Netlify · el frontend

1. **Add new site → Import an existing project**, selecciona el repositorio.
   Netlify lee `netlify.toml` y ya trae la configuración del build.
2. **Edita `netlify.toml`** y cambia la URL del proxy por la de tu servicio de Render:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://TU-API.onrender.com/api/:splat"
```

3. Despliega. Ese proxy hace que el frontend llame a `/api/...` en su propio
   dominio, así que no hay problemas de CORS ni de contenido mixto.
4. Vuelve a Render y pon la URL definitiva de Netlify en `CORS_ORIGIN`.

---

## Qué revisar al terminar

- [ ] `/health` responde `ok: true` con la base y el almacenamiento arriba
- [ ] La landing carga con las fotos de la galería
- [ ] El QR de pago se ve y lo lee tu app bancaria
- [ ] Al subir un comprobante real se leen valor, transacción, cuenta y fecha
- [ ] Un comprobante enviado a otra cuenta se rechaza
- [ ] Una inscripción completa queda guardada y se consulta por documento y por código
- [ ] En Supabase → Storage aparece el archivo del comprobante

---

## Limitaciones del plan gratuito

**La API se duerme.** Render apaga el servicio tras 15 minutos sin tráfico y
tarda cerca de un minuto en revivir. La primera persona que entre después de un
rato espera. Se mitiga con un ping cada 10 minutos desde un cron gratuito.

**Supabase pausa el proyecto tras 7 días sin actividad.** Si el campamento pasa
una semana sin inscripciones, hay que reactivarlo desde el panel. Conviene
entrar cada pocos días durante la campaña.

**500 MB de base y 1 GB de almacenamiento.** Para el tamaño de un campamento
sobra: un comprobante pesa entre 100 y 500 KB, así que caben miles.

**5 GB de tráfico al mes en Netlify.** Las fotos de la galería pesan 2 MB en
total, así que no deberías acercarte.

---

## Desarrollo local

```bash
# Terminal 1 · API
cd backend
npm ci
cp .env.example .env    # STORAGE_DRIVER=local, OCR_PROVIDER=auto
npm run db:migrate
npm start

# Terminal 2 · frontend
cd frontend
npm ci
npx ng serve
```

En local el almacenamiento es el disco (`backend/uploads/`) y el OCR es
Tesseract, así que no necesitas credenciales de Supabase Storage ni de Gemini.

Para borrar todos los datos de prueba: `npm run db:reset`. Contra una base
remota pide confirmación escrita.
