# API REST

Base: `/api`. JSON en ambos sentidos. Toda petición que modifica datos (POST/PUT/PATCH/DELETE) requiere la cabecera `X-Requested-With: crm`; las del panel además `X-CSRF-Token` (se obtiene en el login o en `/api/admin/auth/me`). Errores: `{ error, message, details?, fields? }` con 400 validación, 401 sin sesión, 403 sin permiso, 404 no existe o fuera de tu alcance, 409 conflicto (concurrencia/horario tomado), 423 cuenta bloqueada, 429 demasiados intentos.

## Público (sin sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/public/vacancies` | Vacantes publicadas |
| GET | `/public/vacancies/:slug` | Detalle público de vacante (registra visita) |
| GET | `/public/links/:code` | Vacante de una liga de reclutamiento (registra visita con fuente) |
| GET | `/public/privacy-notice` | Aviso de privacidad vigente |
| POST | `/public/apply/start` | `{linkCode|vacancySlug, firstName, lastName, phone?, email?, channel: sms|whatsapp|email}` → envía código. Devuelve `challengeId`, destino enmascarado y, solo en sandbox de desarrollo, `devCode` |
| POST | `/public/login/start` | `{identifier, channel?}` → código para continuar. Respuesta idéntica exista o no la persona |
| POST | `/public/otp/resend` | `{challengeId}` |
| POST | `/public/otp/verify` | `{challengeId, code}` → crea/recupera candidato y postulación, crea cookie de sesión `cand_sid` (30 días). `{applicationId, resumed}` |

Límites: 3 códigos por destino cada 15 min, 10 por día, 30 por IP por hora; 5 intentos por código; vence en 10 min.

## Portal del candidato (cookie `cand_sid`)

Todas validan que la postulación o cita pertenezca al candidato de la sesión (si no, 404).

| Método | Ruta | Descripción |
|---|---|---|
| GET/PATCH | `/portal/me` | Perfil y postulaciones / actualizar correo, ciudad, canal preferido, no contactar |
| POST | `/portal/logout` | Cierra sesión |
| GET | `/portal/applications/:id` | Estado, paso visible, siguiente acción, preguntas (sin puntuaciones), citas |
| POST | `/portal/applications/:id/registration` | `{noticeId, acceptPrivacy:true, city, preferredChannel, consents}` |
| PUT | `/portal/applications/:id/answers` | Guardado parcial `{answers:{questionId:value}}` |
| POST | `/portal/applications/:id/prequal/submit` | Evalúa y devuelve el mensaje para el candidato |
| GET | `/portal/applications/:id/slots` | Horarios disponibles |
| POST | `/portal/applications/:id/interviews` | `{slotId}` agenda |
| POST | `/portal/interviews/:id/reschedule` | `{slotId}` (máx. 3) |
| POST | `/portal/interviews/:id/confirm` | Confirma asistencia |
| POST | `/portal/interviews/:id/cancel` | `{reason}` |
| POST | `/portal/applications/:id/withdraw` | Retiro voluntario |
| POST | `/portal/help` | `{applicationId?, topic, message}` crea tarea de incidencia |

## Panel (cookie `staff_sid` + CSRF)

| Método | Ruta | Permiso |
|---|---|---|
| POST | `/admin/auth/login` · `/admin/auth/logout` · GET `/admin/auth/me` | — |
| GET | `/admin/catalogs` | sesión |
| POST | `/admin/clients` · `/admin/campaigns` · `/admin/sites` · `/admin/sources` | config.manage |
| GET | `/admin/vacancies` · `/admin/vacancies/:id` | vacancy.read (con alcance) |
| POST/PUT | `/admin/vacancies` · `/admin/vacancies/:id` | vacancy.manage (su equipo) |
| POST | `/admin/vacancies/:id/status` `{status}` | vacancy.manage |
| POST | `/admin/vacancies/:id/questions` · PUT `/admin/questions/:qid` · POST `/admin/questions/:qid/active` | vacancy.manage |
| POST | `/admin/vacancies/:id/links` · `/admin/links/:id/active` | vacancy.read (reclutador: solo ligas a su nombre) |
| GET | `/admin/applications?q&vacancyId&sourceId&recruiterId&stage&stageCategory&prequalResult&campaignId&from&to&stalled&sort&dir&page&pageSize` | application.read |
| GET | `/admin/applications/export.csv` (mismos filtros, auditado) | export |
| GET | `/admin/applications/:id` (auditado) | application.read |
| POST | `/admin/applications/:id/move` `{toStage, expectedStage, reason?, closureReasonId?, comment?, nextAction?, override?}` | application.move (+ pipeline.override) |
| POST | `/admin/applications/bulk-move` | application.move |
| POST | `/admin/applications/:id/assign` | application.assign |
| POST | `/admin/applications/:id/notes` `{body, kind: nota|contacto, contactOutcome?}` | note.write |
| GET/POST/PATCH | `/admin/tasks` · `/admin/tasks/:id` | application.read / task.manage |
| GET | `/admin/agenda?from&to&interviewerId` | sesión (entrevistador: solo lo suyo) |
| POST/DELETE | `/admin/slots` · `/admin/slots/:id` | schedule.manage |
| GET/POST | `/admin/applications/:id/slots` · `/admin/applications/:id/interviews` | schedule.manage |
| POST | `/admin/interviews/:id/reschedule` · `/cancel` | schedule.manage |
| POST | `/admin/interviews/:id/attendance` `{status: realizada|no_asistio, result?, notes?}` | interview.evaluate |
| GET | `/admin/dashboard?from&to&vacancyId&sourceId&recruiterId&campaignId` | dashboard.read |
| GET | `/admin/alerts` | application.read |
| GET/POST | `/admin/duplicates` · `/admin/duplicates/:id/resolve` | duplicates.resolve |
| GET | `/admin/messages` | messages.read |
| GET/POST | `/admin/notifications` · `/admin/notifications/read` | sesión |
| GET | `/admin/audit?entityId&action` | audit.read |
| GET | `/admin/search?q` | application.read |

La matriz completa de permisos por rol está en `server/src/lib/permissions.ts` y el alcance de datos en `server/src/lib/scope.ts`.
