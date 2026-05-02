# Minecraft TikTok Bridge - Backend

Backend API para Minecraft TikTok Bridge. Este repositorio contiene el servidor Express, la integración con RCON, TikTok LIVE, persistencia y cache de imágenes.

## Repos relacionados

- Frontend: [Minecraft-TikTok-Bridge-Using-Rcon-Frontend](https://github.com/RADD95/Minecraft-TikTok-Bridge-Using-Rcon-Frontend)
- Backend: [Minecraft-TikTok-Bridge-Using-Rcon-Backend](https://github.com/RADD95/Minecraft-TikTok-Bridge-Using-Rcon-Backend)

## Qué hace este repo

- Expone la API para configuración, acciones, estadísticas y cola.
- Conecta con Minecraft por RCON.
- Recibe eventos de TikTok LIVE.
- Guarda datos persistentes en disco.
- Sirve cache de imágenes en `/cache`.
- Expone overlays públicos por `/api/public/overlays/:id`.

## Requisitos

- Node.js 18+ recomendado.
- Minecraft con RCON habilitado.
- Acceso a TikTok LIVE para capturar eventos.

## Instalación

```bash
npm install
```

## Variables de entorno

Este repo incluye un archivo de ejemplo:

- `.env.example`

Para configurar localmente:

```bash
cp .env.example .env
```

Variables usadas:

- `PORT`: puerto del backend (default `4567`).
- `JWT_SECRET`: secreto JWT para autenticación.
- `EULER_FALLBACK_API_KEY`: llave opcional para el fallback de firma de TikTok LIVE.
- `CORS_ORIGIN`: orígenes permitidos por CORS (separados por coma).
- `COOKIE_SAME_SITE`: `lax`, `strict` o `none`.
- `COOKIE_SECURE`: `true` o `false`.
- `COOKIE_DOMAIN`: dominio de cookie (opcional).

Ejemplo para frontend en Vercel + backend en VPS:

- `CORS_ORIGIN=https://tu-frontend.vercel.app`
- `COOKIE_SAME_SITE=none`
- `COOKIE_SECURE=true`

## Ejecución

```bash
npm start
```

Servidor por defecto:

- API: `http://localhost:4567`

## Variables y archivos locales

Este backend usa archivos de persistencia locales como:

- `config.json`
- `actions.json`
- `stats.json`
- `data/`

El archivo `.gitignore` ya excluye estos artefactos para no subir bases ni cache pesado al repositorio.

## Endpoints principales

- `GET /api/status`
- `GET /api/config`
- `POST /api/config`
- `GET /api/actions`
- `POST /api/actions`
- `PUT /api/actions/:index`
- `DELETE /api/actions/:index`
- `GET /api/stats`
- `POST /api/stats/reset`
- `POST /api/rcon/connect`
- `POST /api/rcon/disconnect`
- `POST /api/rcon/test`
- `POST /api/rcon/command`
- `POST /api/tiktok/start`
- `POST /api/tiktok/stop`
- `POST /api/cache-image`
- `GET /api/public/overlays/:id`

## Despliegue

- Este proyecto está pensado para correr en tu VPS.
- El frontend consume este backend por API.
- Si cambias de host o puerto, actualiza el frontend para apuntar al backend correcto.

## Nota

Este repos ya no incluye la interfaz web principal. Esa parte vive en el repositorio del frontend.

