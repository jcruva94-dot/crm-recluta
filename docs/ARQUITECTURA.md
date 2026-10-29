# CRM Recluta: análisis y arquitectura (Fase 1)

## 1. Diagnóstico del proceso (call center / BPO de alto volumen)

Los cuellos de botella típicos que este sistema ataca desde el núcleo:

| Problema operativo | Consecuencia | Respuesta del sistema |
|---|---|---|
| Formularios largos antes de conocer la vacante | Abandono en móvil | Landing con requisitos, sueldo y pasos antes de pedir datos; registro en 3 campos + OTP |
| Candidatos duplicados entre Excel, WhatsApp y portales | Doble contacto, métricas infladas | Identidad única por teléfono/correo normalizados; la persona se separa de sus postulaciones; coincidencias dudosas van a revisión, no a bloqueo |
| Precalificación por "criterio" del reclutador | Inconsistencia, sesgo, sin trazabilidad | Motor configurable por vacante con indispensables, ponderaciones, umbrales y explicación por criterio |
| Ida y vuelta de mensajes para agendar | Días perdidos e inasistencias | El candidato elige horario desde su portal; el backend evita choques con restricciones de base de datos |
| Candidatos "olvidados" entre etapas | Pérdida de talento | Etapas con SLA, tareas automáticas, bandeja priorizada y alertas de estancamiento |
| Indicadores armados a mano | Decisiones con datos poco confiables | KPIs calculados en SQL sobre registros reales, con fórmula y denominador explícitos |

## 2. Decisiones de arquitectura

| Capa | Elección | Justificación |
|---|---|---|
| Base de datos | PostgreSQL 16 | Transacciones, restricciones de exclusión (`btree_gist`) para impedir choques de agenda a nivel de datos, JSONB para configuración flexible de preguntas |
| Backend | Node.js 22 + TypeScript + Fastify + `pg` (SQL explícito) + Zod | API REST tipada, validación en servidor, consultas parametrizadas (sin inyección SQL), sin ORM que oculte las transacciones críticas |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS | Un solo SPA con dos experiencias: portal del candidato (mobile-first) y panel administrativo |
| Sesiones | Cookies `httpOnly` con token opaco; en BD solo se guarda su hash SHA-256 | Revocables, sin datos personales en el token; CSRF mitigado con `SameSite=Strict` + token anti-CSRF en cabecera para el panel |
| Contraseñas (staff) | `scrypt` con sal por usuario; bloqueo tras 5 intentos | Sin dependencias nativas |
| Acceso del candidato | OTP de 6 dígitos validado en el backend (hash HMAC, vencimiento 10 min, 5 intentos, límite de envíos) | Sin contraseña; permite "continuar más tarde" desde cualquier dispositivo |
| Mensajería | Bandeja de salida (outbox) con proveedor intercambiable | Sin credenciales se usa el proveedor **sandbox**: los mensajes quedan marcados como *simulados* y nunca se reportan como enviados |
| Pruebas | Vitest + `fastify.inject` contra PostgreSQL real; Playwright para el flujo móvil E2E | Las pruebas ejercitan transacciones, permisos y concurrencia reales |

Alternativa descartada: Next.js full-stack. Se prefirió separar API y SPA para que la API sea consumible por futuras integraciones (WhatsApp, portales de empleo, BI) y para aislar mejor la autorización.

## 3. Modelo de datos (núcleo)

```
teams ─< users >─ staff_sessions
clients ─< campaigns
sites, sources, pipeline_stages ─< stage_transitions
vacancies (client, campaign, site, team) ─< vacancy_recruiters >─ users
vacancies ─< prequal_questions
vacancies ─< tracking_links (fuente, campaña, reclutador, evento) ─< tracking_events
candidates ─< applications >─ vacancies          (persona ≠ postulación)
candidates ─< consents >─ privacy_notices (versionados)
candidates ─< candidate_sessions ; otp_challenges
applications ─< prequal_answers ; stage_history ; tasks ; notes ; interviews
interview_slots (EXCLUDE choque por entrevistador) ─< interviews (índice único: un slot = una cita activa)
outbox_messages ; notifications ; duplicate_reviews ; audit_log
```

Reglas de integridad clave:
- `unique(candidate_id, vacancy_id)` en postulaciones: una persona no puede postularse dos veces a la misma vacante; se recupera el proceso existente.
- Teléfono y correo normalizados con índice único parcial (excluye anonimizados).
- `EXCLUDE USING gist (interviewer_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`: un entrevistador no puede tener horarios traslapados.
- Índice único parcial en `interviews(slot_id)` para citas activas: dos candidatos no pueden tomar el mismo horario aunque lleguen al mismo milisegundo.
- Cambios de etapa con `SELECT … FOR UPDATE` y etapa esperada (control de concurrencia optimista): si alguien movió al candidato antes, se responde 409.

## 4. Reglas de negocio adoptadas (supuestos documentados)

1. **La puntuación no rechaza.** Solo un requisito indispensable no cumplido produce "No cumple"; aun así, el sistema **no** rechaza automáticamente: envía a "Revisión de compatibilidad" para decisión humana.
2. Resultados: `compatible` (≥ umbral alto, sin alertas) → puede agendar solo; `compatible_con_observaciones` (≥ umbral bajo) → puede agendar y se crea tarea de revisión; `requiere_revision` (respuestas marcadas para revisión, información insuficiente o puntuación baja) y `no_cumple` → revisión humana.
3. Preguntas con temas protegidos (edad, género, estado civil, religión, embarazo, discapacidad, origen étnico, apariencia, etc.) no pueden ser indispensables ni ponderadas: el backend las rechaza. Toda pregunta indispensable exige justificación del requisito del puesto.
4. Las etapas de cierre (rechazado, retirado, no localizado, abandono, reserva) exigen motivo. Transiciones fuera del mapa permitido solo con permiso `pipeline.override` y motivo; quedan marcadas como excepción.
5. Inasistencia: la cita se marca "no asistió", la postulación regresa a "Contacto pendiente", se crea tarea de recuperación y el candidato puede reagendar. Se cierra solo por decisión humana.
6. Asignación automática al registrarse: reclutador asignado a la vacante con menor carga activa (estrategia configurable por vacante: `menor_carga` o `rotativa`).
7. Zona horaria operativa: `America/Mexico_City` (configurable).

## 5. Roles y alcance de datos

| Rol | Alcance |
|---|---|
| admin | Todo, incluida configuración |
| director | Lectura global, indicadores, exportación |
| gerente | Vacantes y postulaciones de su equipo; configura vacantes; exporta |
| coordinador | Vacantes de su equipo; asigna y mueve |
| reclutador | Vacantes donde está asignado o postulaciones que tiene asignadas |
| entrevistador | Solo candidatos con citas suyas; sin teléfono ni correo |
| auditor | Lectura global con contacto enmascarado; bitácora |
| candidato | Solo su perfil y sus postulaciones (validado en cada consulta por `candidate_id` de la sesión) |

La autorización se aplica en el servidor en cada endpoint; la interfaz solo oculta botones como comodidad.

## 6. Riesgos principales

- **Entrega de OTP sin proveedor real**: sin SMS/WhatsApp/correo configurado, el código solo es visible en modo sandbox. Es el bloqueador #1 para producción.
- **Cumplimiento LFPDPPP**: el aviso de privacidad incluido es un borrador técnico; debe redactarlo/validarlo el área legal.
- **Calidad de reglas de precalificación**: reglas mal configuradas excluyen talento; por eso ningún resultado automático rechaza.
- **Volumen**: índices y paginación del lado del servidor están desde el inicio; colas de trabajo (BullMQ/pg-boss) quedan para la fase 3.

## 7. Priorización

- Fase 1–2 (esta entrega): vacantes, ligas, registro + OTP, consentimiento, precalificación, ficha, pipeline, tareas, agenda, dashboard básico real, auditoría, permisos.
- Fase 3: documentos, ofertas, contratación, onboarding, automatizaciones configurables, plantillas.
- Fase 4: analítica avanzada, costos por fuente, alertas ejecutivas.
- Fase 5: integraciones reales (WhatsApp Business, SMTP/SES, Google/Outlook Calendar, almacenamiento S3), despliegue y monitoreo.
