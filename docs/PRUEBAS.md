# Reporte de pruebas

Fecha de ejecución: 2026-10-29 · Entorno: Linux, Node 22, PostgreSQL 16.15, Chromium (Playwright).
Todas las pruebas se ejecutaron contra una base PostgreSQL real (sin mocks de base de datos).

## Resumen

| Suite | Resultado |
|---|---|
| Typecheck backend (`tsc --noEmit`) | OK |
| Typecheck + build frontend (`tsc -b && vite build`) | OK |
| API e integración (Vitest, 6 archivos) | **50 / 50 pasan** |
| E2E en navegador (Chromium, viewport Pixel 7 y escritorio) | **20 / 20 pasos pasan** |

Defecto real encontrado por las pruebas y corregido: el bloqueo de cuenta tras 5 intentos fallidos no se activaba (`auth.ts`). También se corrigió que, tras recompilar el frontend sin reiniciar, el servidor devolvía HTML para archivos `/assets` nuevos.

## Qué NO se probó

- Envío real de SMS/WhatsApp/correo (no hay proveedor configurado; los mensajes quedan como *simulados*).
- Ofertas, contratación y onboarding (módulos aún no construidos). Documentos: probados con PDFs sintéticos; no se probó con escaneos reales pesados ni antivirus.
- Pruebas de carga/volumen y recuperación ante caída de base de datos.
- Auditoría de accesibilidad automatizada (axe); se verificó navegación por etiquetas/roles en E2E y ausencia de scroll horizontal en móvil.
- Navegadores Safari/Firefox reales.

## E2E (flujo del candidato y del reclutador)

```
✓ 1. Abrir liga de vacante desde un celular
✓ 2. Iniciar registro y validar campos
✓ 3. Verificar identidad con OTP (validado en el backend)
✓ 4-5. Completar datos y aceptar aviso de privacidad
✓ 6. Abandonar el proceso a mitad de la precalificación y regresar
✓ 7. Completar la precalificación
✓ 8. Recibir resultado consistente con las reglas (compatible → agendar)
✓ 9. Agendar una entrevista
✓ 10. Reprogramar la entrevista
✓ 12. Consultar estado en el portal y pedir ayuda
✓ El candidato abre de nuevo la liga y ve su estatus (no un registro nuevo)
✓ Continuar más tarde desde otro dispositivo (login sin contraseña)
✓ Admin: login y dashboard con datos reales
✓ Admin: el candidato aparece en el pipeline (Kanban) y la ficha muestra la explicación
✓ Admin: solicitar documentos desde la ficha
✓ Candidato: sube un PDF desde el celular; un archivo no PDF se rechaza
✓ Admin: revisa y aprueba el documento
✓ Admin: transición inválida no se ofrece y el cambio válido queda en historial
✓ Admin: un reclutador no puede abrir la auditoría (403 del servidor)
✓ Admin (gerente): mensajes marcados como simulados (no enviados)

20/20 pasos OK
```

Capturas en `docs/capturas/`.

## API e integración (detalle)

```
✓ test/permissions.test.ts > seguridad y permisos > un candidato no puede ver ni modificar la postulación de otro (IDOR)
 ✓ test/permissions.test.ts > seguridad y permisos > un candidato no puede manipular la cita de otro
 ✓ test/permissions.test.ts > seguridad y permisos > las peticiones que modifican datos exigen cabecera anti-CSRF
 ✓ test/permissions.test.ts > seguridad y permisos > login de staff: credenciales incorrectas y bloqueo tras 5 intentos
 ✓ test/permissions.test.ts > seguridad y permisos > endpoints administrativos sin sesión responden 401
 ✓ test/permissions.test.ts > seguridad y permisos > matriz de permisos por rol en endpoints sensibles
 ✓ test/permissions.test.ts > seguridad y permisos > el entrevistador no ve datos de contacto y el auditor los ve enmascarados
 ✓ test/permissions.test.ts > seguridad y permisos > un reclutador solo lista postulaciones de su alcance
 ✓ test/permissions.test.ts > seguridad y permisos > las consultas de expediente y exportaciones quedan en auditoría
 ✓ test/permissions.test.ts > seguridad y permisos > no se aceptan preguntas sobre datos protegidos ni indispensables sin justificación
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > rechaza transiciones inválidas y exige motivo para cerrar
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > excepciones: solo con permiso y motivo, quedan marcadas
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > concurrencia: dos usuarios moviendo la misma postulación, uno recibe 409
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > no permite marcar "entrevista agendada" sin reservar un horario
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > registro de contacto actualiza último contacto y cierra la tarea de contactar
 ✓ test/pipeline-schedule.test.ts > pipeline: reglas de transición > tareas vencidas se identifican en la bandeja
 ✓ test/pipeline-schedule.test.ts > agenda > dos candidatos no pueden reservar el mismo horario al mismo tiempo
 ✓ test/pipeline-schedule.test.ts > agenda > la base de datos impide horarios traslapados del mismo entrevistador
 ✓ test/pipeline-schedule.test.ts > agenda > inasistencia: ruta de recuperación y reagenda; asistencia avanza la etapa
 ✓ test/pipeline-schedule.test.ts > agenda > notificaciones con clave de idempotencia no se duplican
 ✓ test/documents.test.ts > documentos en PDF > flujo completo: solicitar → subir PDF → corrección → nueva versión → aprobar
 ✓ test/documents.test.ts > documentos en PDF > rechaza archivos que no son PDF real y archivos de más de 5 MB
 ✓ test/documents.test.ts > documentos en PDF > nadie fuera del expediente puede subir ni descargar
 ✓ test/documents.test.ts > documentos en PDF > al pasar a "Documentación pendiente" se solicitan los documentos de la vacante
 ✓ test/documents.test.ts > documentos en PDF > el portal informa la vacante de cada postulación (para mostrar el estatus en la liga)
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > liga → registro → OTP → aviso → precalificación → agenda → reprogramación → confirmación
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > candidato que no cumple un indispensable va a revisión humana (no se rechaza solo)
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > el OTP se valida en el backend: código incorrecto, intentos máximos y vencimiento
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > limita el envío de códigos por destino
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > el portal no funciona sin sesión verificada
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > continuar más tarde: login con OTP recupera la misma postulación
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > login con identificador inexistente no revela si existe
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > duplicados: misma persona y misma vacante recupera el proceso; correo de otra persona va a revisión
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > candidato sin correo puede registrarse por teléfono
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > una vacante cerrada no recibe nuevas postulaciones
 ✓ test/candidate-flow.test.ts > flujo del candidato (extremo a extremo vía API) > el candidato puede retirarse y se libera su cita
 ✓ test/reports.test.ts > indicadores calculados con datos reales > candidatos únicos ≠ postulaciones; oferta aceptada ≠ ingreso efectivo
 ✓ test/reports.test.ts > indicadores calculados con datos reales > cada KPI trae definición y las conversiones traen numerador y denominador
 ✓ test/reports.test.ts > indicadores calculados con datos reales > el dashboard respeta el alcance del usuario
 ✓ test/reports.test.ts > indicadores calculados con datos reales > alertas de estancamiento usan el SLA de la etapa
 ✓ test/prequal-engine.test.ts > motor de precalificación > compatible cuando cumple indispensables y supera el umbral
 ✓ test/prequal-engine.test.ts > motor de precalificación > no_cumple solo por indispensable, aunque la puntuación sea alta
 ✓ test/prequal-engine.test.ts > motor de precalificación > compatible_con_observaciones entre umbrales
 ✓ test/prequal-engine.test.ts > motor de precalificación > puntuación baja va a revisión humana, nunca a rechazo
 ✓ test/prequal-engine.test.ts > motor de precalificación > respuesta marcada para revisión produce requiere_revision
 ✓ test/prequal-engine.test.ts > motor de precalificación > información insuficiente en obligatoria produce revisión
 ✓ test/prequal-engine.test.ts > motor de precalificación > fecha de ingreso lejana pide revisión
 ✓ test/prequal-engine.test.ts > motor de precalificación > es determinista (explicable y auditable)
 ✓ test/prequal-engine.test.ts > motor de precalificación > valida respuestas
 ✓ test/prequal-engine.test.ts > motor de precalificación > detecta temas protegidos y permite "mayor de edad"
 Test Files  6 passed (6)
      Tests  50 passed (50)
```
