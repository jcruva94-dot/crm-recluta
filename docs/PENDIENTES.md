# Estado: implementado, probado, pendiente

## Implementado y probado (fase 1-2)

Vacantes configurables · ligas con atribución (fuente, campaña, reclutador, evento) · landing móvil · registro con OTP validado en backend · sesiones seguras · aviso de privacidad versionado y consentimientos · detección y revisión de duplicados · precalificación configurable con motor explicable · ficha integral · pipeline Kanban/tabla con reglas de transición, excepciones autorizadas y control de concurrencia · tareas automáticas y bandeja priorizada · agenda con prevención de choques, autoagendado, reprogramación, cancelación, confirmación, asistencia e inasistencia con ruta de recuperación · asignación automática (menor carga o rotativa) · notificaciones internas · bandeja de mensajes (sandbox) con idempotencia y respeto a "no contactar" · dashboard con KPIs calculados, definiciones y denominadores · alertas operativas · exportación CSV auditada · bitácora de auditoría · 7 roles con alcance por equipo/asignación verificado en servidor.

## Integraciones pendientes de credenciales externas

| Integración | Estado | Qué falta |
|---|---|---|
| SMS / WhatsApp Business / correo | **No conectado.** Contrato `DeliveryProvider` en `server/src/modules/messaging.ts`; los mensajes quedan como `simulado` | Elegir proveedor (Meta WhatsApp Cloud API, Twilio, SES/SMTP), plantillas aprobadas por Meta, un worker que procese `outbox_messages` con estado `pendiente`, reintentos y webhooks de entrega. **Bloqueante para producción**: sin esto el candidato no recibe su código |
| Google Calendar / Outlook | No implementado | OAuth por entrevistador; hoy la agenda es interna y el enlace de videollamada se captura a mano |
| Almacenamiento de documentos | No implementado (fase 3) | Bucket privado (S3/GCS) con URLs firmadas, antivirus, retención |
| Firma electrónica | No implementado | Proveedor autorizado (p. ej. Mifiel, DocuSign); no se simula con casillas |
| Proveedor de IA | No implementado | Capa opcional; ninguna decisión depende de IA |
| Portales de empleo | No implementado | Ligas con fuente ya permiten medir; importación por API pendiente |

## Funcionalidad pendiente (siguientes fases)

- **Fase 3**: documentos (estados, versiones, validación, carga móvil), ofertas con plantillas y autorización, contratación, onboarding con seguimiento 7/30/60 días y bajas tempranas; motor de automatizaciones configurable desde UI (hoy las reglas automáticas están en código), plantillas de mensajes editables, recordatorios programados (requiere cola de trabajos, p. ej. pg-boss).
- **Fase 4**: gasto por campaña y costo por candidato/contratación, permanencia temprana, cohortes comparables por semana, reportes exportables.
- **Configuración sin código pendiente**: administración de usuarios/roles, etapas, motivos y catálogos desde UI (hoy: catálogos por API y semilla; etapas por migración), formularios de entrevista por perfil, políticas de retención y anonimización.
- **Fusión de expedientes duplicados** (hoy se marca la resolución; la fusión física es manual).
- Derechos ARCO automatizados (hoy se solicitan por Ayuda y quedan como tarea).

## Riesgos conocidos

1. **Aviso de privacidad**: es un borrador técnico; debe redactarlo/aprobarlo el área legal (LFPDPPP).
2. **Sin proveedor de mensajería** el registro público no funciona fuera del modo de pruebas.
3. **Lista de temas protegidos** se basa en palabras clave: reduce el riesgo pero no sustituye la revisión humana de cada pregunta.
4. **Límite de intentos** de OTP está en base de datos; el límite de login de staff es por cuenta (no por IP). Falta rate limiting general en el proxy.
5. **Zona horaria** fija `America/Mexico_City` en la interfaz; operaciones en otras zonas requieren ajuste.
6. **Escalabilidad**: consultas indexadas y paginadas; el dashboard calcula en vivo y con cientos de miles de postulaciones convendrá materializar agregados.
7. **Cifrado en reposo** depende de la configuración del PostgreSQL administrado; no hay cifrado a nivel de columna.
8. Sin monitoreo, respaldos automatizados ni procedimiento de incidentes configurados (dependen de la infraestructura de despliegue).
