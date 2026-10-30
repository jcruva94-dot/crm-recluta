# CRM Recluta: CRM de reclutamiento para Call Center / BPO

Plataforma con dos experiencias conectadas a una misma base de datos:

- **Portal del candidato** (móvil, sin descargar app ni contraseña): vacante → registro → verificación por código → aviso de privacidad → precalificación → agenda de entrevista → seguimiento.
- **Panel del equipo de reclutamiento**: dashboard con KPIs reales, bandeja de trabajo priorizada, pipeline Kanban/tabla, ficha integral del candidato, vacantes configurables, ligas con atribución, agenda, mensajes, duplicados y auditoría, con permisos por rol verificados en el servidor.

> **Estado: fase 1-2 (núcleo funcional).** No está listo para producción: falta conectar un proveedor real de SMS/WhatsApp/correo, revisión legal del aviso de privacidad y los módulos de documentos, ofertas y onboarding. Ver [docs/PENDIENTES.md](docs/PENDIENTES.md).

## Requisitos

- Node.js 22+
- PostgreSQL 16 (local o `docker compose up -d db`)

## Instalación y ejecución local

```bash
npm install                         # instala server y web (workspaces)
cp server/.env.example server/.env  # ajusta DATABASE_URL y OTP_SECRET
createdb crm_recluta                # o usa docker compose
npm run db:seed                     # aplica migraciones y crea datos DEMO
npm run db:seed -- --actividad      # opcional: 84 candidatos ficticios (DEMO) para que el dashboard tenga movimiento
npm run build                       # compila el frontend y el backend
npm start                           # http://localhost:3000
```

Modo desarrollo con recarga: `npm run dev -w server` (puerto 3000) y `npm run dev -w web` (puerto 5173, con proxy a la API).

### Rutas principales

| Ruta | Para quién |
|---|---|
| `/empleo` | Vacantes publicadas |
| `/empleo/l/ventas-fb` | Liga de prueba (fuente Facebook) |
| `/portal/ingresar` | Candidato que regresa (código, sin contraseña) |
| `/admin` | Panel del equipo |

### Usuarios de demostración (solo datos ficticios)

Contraseña para todos: `Demo-2026!`. **No usar en producción.**

| Rol | Correo |
|---|---|
| Administrador | admin@demo.test |
| Director | director@demo.test |
| Gerente | gerente@demo.test |
| Coordinador | coordinador@demo.test |
| Reclutador | reclutador1@demo.test, reclutador2@demo.test, reclutador3@demo.test (otro equipo) |
| Entrevistador | entrevistador@demo.test |
| Auditor | auditor@demo.test |

Los datos demo llevan "(DEMO)" en el nombre o `is_demo = true`; teléfonos y correos (`@demo.test`, `@ejemplo.test`) son ficticios.

## Pruebas

```bash
createdb crm_recluta_test
npm test                                     # 45 pruebas de API/integración contra PostgreSQL real
BASE_URL=http://localhost:3000 npm run test:e2e   # flujo completo en Chromium con viewport móvil
```

La prueba E2E requiere la app corriendo con `DELIVERY_MODE=sandbox` y `EXPOSE_DEV_OTP=true`. Resultados reales: [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Despliegue (resumen)

1. PostgreSQL administrado con respaldos automáticos (p. ej. RDS, Cloud SQL, Azure Database) y TLS.
2. `NODE_ENV=production`, `OTP_SECRET` de ≥32 caracteres, `PUBLIC_BASE_URL` con https, `EXPOSE_DEV_OTP=false`.
3. `npm ci && npm run build && npm start` detrás de un proxy con HTTPS (las cookies se marcan `Secure` en producción).
4. Las migraciones se aplican al iniciar (`server/migrations/*.sql`, transaccionales).
5. Configura un proveedor de mensajería antes de abrir el registro al público (sin él, nadie recibe su código).

## Documentación

- [Análisis y arquitectura](docs/ARQUITECTURA.md)
- [API](docs/API.md)
- [Manuales: administrador, reclutador y candidato](docs/MANUALES.md)
- [Integraciones pendientes y riesgos](docs/PENDIENTES.md)
- [Reporte de pruebas](docs/PRUEBAS.md)

## Estructura

```
server/   API Fastify + TypeScript + SQL (migrations/, src/routes, src/modules, test/)
web/      SPA React + Vite + Tailwind (src/candidate, src/admin, e2e/)
docs/     Arquitectura, API, manuales, pendientes y pruebas
```
