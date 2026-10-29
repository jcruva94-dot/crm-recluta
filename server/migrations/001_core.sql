-- CRM Recluta: esquema núcleo (fase 1-2)
create extension if not exists btree_gist;

-- ===== Organización y usuarios =====
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  full_name text not null,
  role text not null check (role in ('admin','director','gerente','coordinador','reclutador','entrevistador','auditor')),
  team_id uuid references teams(id) on delete set null,
  password_hash text not null,
  is_active boolean not null default true,
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table staff_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  csrf_token text not null,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);

-- ===== Catálogos =====
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (client_id, name)
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  city text,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_-]+$'),
  name text not null,
  kind text not null default 'otra' check (kind in ('redes_sociales','referido','bolsa_trabajo','feria','base_propia','campo','web','publicidad','mensajeria','otra')),
  is_active boolean not null default true
);

create table pipeline_stages (
  code text primary key,
  name text not null,
  position int not null,
  category text not null check (category in ('activo','contratado','cerrado','reserva')),
  candidate_step int not null check (candidate_step between 0 and 5), -- paso visible para el candidato
  requires_reason boolean not null default false,
  sla_hours int,
  is_active boolean not null default true
);

create table stage_transitions (
  from_code text not null references pipeline_stages(code) on delete cascade,
  to_code text not null references pipeline_stages(code) on delete cascade,
  primary key (from_code, to_code)
);

create table closure_reasons (
  id uuid primary key default gen_random_uuid(),
  stage_code text not null references pipeline_stages(code),
  name text not null,
  is_active boolean not null default true,
  unique (stage_code, name)
);

create table privacy_notices (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  body text not null,
  is_current boolean not null default false,
  published_at timestamptz not null default now()
);
create unique index privacy_notices_one_current on privacy_notices (is_current) where is_current;

-- ===== Vacantes =====
create table vacancies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  client_id uuid references clients(id) on delete restrict,
  campaign_id uuid references campaigns(id) on delete restrict,
  site_id uuid references sites(id) on delete restrict,
  team_id uuid references teams(id) on delete set null,
  modality text not null check (modality in ('presencial','remoto','hibrido')),
  positions int not null default 1 check (positions > 0),
  hire_goal int not null default 1 check (hire_goal > 0),
  opened_at date,
  target_fill_date date,
  summary text not null default '',
  activities text[] not null default '{}',
  requirements text[] not null default '{}',
  education text,
  experience text,
  salary_text text,
  schedule_text text,
  benefits text[] not null default '{}',
  process_steps text[] not null default '{}',
  response_time_text text,
  status text not null default 'borrador' check (status in ('borrador','publicada','pausada','cerrada')),
  priority text not null default 'media' check (priority in ('alta','media','baja')),
  threshold_compatible int not null default 70 check (threshold_compatible between 0 and 100),
  threshold_observations int not null default 50 check (threshold_observations between 0 and 100),
  assignment_strategy text not null default 'menor_carga' check (assignment_strategy in ('menor_carga','rotativa')),
  interview_duration_min int not null default 30 check (interview_duration_min between 10 and 240),
  is_demo boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check (threshold_observations <= threshold_compatible)
);
create index vacancies_status on vacancies(status);

create table vacancy_recruiters (
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (vacancy_id, user_id)
);

create table prequal_questions (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  position int not null default 0,
  text text not null,
  help_text text,
  type text not null check (type in ('yes_no','single_choice','multi_choice','number','date','text')),
  required boolean not null default true,
  weight int not null default 0 check (weight between 0 and 100),
  is_knockout boolean not null default false,
  -- motivo mostrado al candidato si no cumple el indispensable
  knockout_message text,
  -- justificación interna del requisito (obligatoria si es indispensable o ponderada)
  justification text,
  options jsonb not null default '[]',
  number_rules jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index prequal_questions_vacancy on prequal_questions(vacancy_id, position);

create table tracking_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{4,40}$'),
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  source_id uuid not null references sources(id),
  campaign_id uuid references campaigns(id),
  recruiter_id uuid references users(id),
  event_name text,
  label text,
  is_active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table tracking_events (
  id bigserial primary key,
  link_id uuid references tracking_links(id) on delete set null,
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  event text not null check (event in ('visit','apply_start','otp_verified')),
  created_at timestamptz not null default now()
);
create index tracking_events_vacancy on tracking_events(vacancy_id, event, created_at);

-- ===== Candidatos =====
create table candidates (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone_e164 text,
  email text check (email = lower(email)),
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  preferred_channel text not null default 'whatsapp' check (preferred_channel in ('whatsapp','sms','email','llamada')),
  do_not_contact boolean not null default false,
  city text,
  is_demo boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_e164 is not null or email is not null or anonymized_at is not null)
);
create unique index candidates_phone_unique on candidates(phone_e164) where phone_e164 is not null and anonymized_at is null;
create unique index candidates_email_unique on candidates(email) where email is not null and anonymized_at is null;
create index candidates_name on candidates(lower(first_name || ' ' || last_name));

create table consents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  notice_id uuid references privacy_notices(id),
  purpose text not null check (purpose in ('aviso_privacidad','contacto_whatsapp','contacto_sms','contacto_email','reserva_talento')),
  granted boolean not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index consents_candidate on consents(candidate_id, purpose, created_at desc);

create table otp_challenges (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('apply','login')),
  channel text not null check (channel in ('sms','whatsapp','email')),
  destination text not null,
  candidate_id uuid references candidates(id) on delete cascade,
  code_hash text not null,
  context jsonb not null default '{}',
  attempts int not null default 0,
  max_attempts int not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index otp_challenges_destination on otp_challenges(destination, created_at desc);

create table candidate_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  candidate_id uuid not null references candidates(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ===== Postulaciones y pipeline =====
create table applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  vacancy_id uuid not null references vacancies(id) on delete restrict,
  link_id uuid references tracking_links(id) on delete set null,
  first_source_id uuid references sources(id),
  last_source_id uuid references sources(id),
  recruiter_id uuid references users(id) on delete set null,
  stage_code text not null references pipeline_stages(code),
  stage_entered_at timestamptz not null default now(),
  closure_reason_id uuid references closure_reasons(id),
  registration_completed_at timestamptz,
  prequal_result text check (prequal_result in ('compatible','compatible_con_observaciones','requiere_revision','no_cumple')),
  prequal_score numeric(5,2),
  prequal_explanation jsonb,
  prequal_completed_at timestamptz,
  next_action text,
  next_action_at timestamptz,
  last_contact_at timestamptz,
  no_show_count int not null default 0,
  version int not null default 0,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, vacancy_id)
);
create index applications_stage on applications(stage_code, stage_entered_at);
create index applications_vacancy on applications(vacancy_id, stage_code);
create index applications_recruiter on applications(recruiter_id, stage_code);
create index applications_created on applications(created_at);

create table prequal_answers (
  application_id uuid not null references applications(id) on delete cascade,
  question_id uuid not null references prequal_questions(id) on delete cascade,
  value jsonb not null,
  answered_at timestamptz not null default now(),
  primary key (application_id, question_id)
);

create table stage_history (
  id bigserial primary key,
  application_id uuid not null references applications(id) on delete cascade,
  from_code text references pipeline_stages(code),
  to_code text not null references pipeline_stages(code),
  actor_type text not null check (actor_type in ('user','candidate','system')),
  user_id uuid references users(id),
  reason text,
  closure_reason_id uuid references closure_reasons(id),
  comment text,
  next_action text,
  is_override boolean not null default false,
  created_at timestamptz not null default now()
);
create index stage_history_app on stage_history(application_id, created_at);
create index stage_history_to on stage_history(to_code, created_at);

create table notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  kind text not null default 'nota' check (kind in ('nota','contacto')),
  contact_outcome text check (contact_outcome in ('contactado','no_contesta','numero_invalido','reagendar','no_interesado')),
  created_at timestamptz not null default now()
);
create index notes_app on notes(application_id, created_at desc);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  type text not null check (type in ('contactar','agendar','confirmar','entrevistar','revisar_perfil','validar_documentos','solicitar_info','emitir_oferta','incidencia','recuperar')),
  title text not null,
  assignee_id uuid references users(id) on delete set null,
  due_at timestamptz not null,
  priority text not null default 'media' check (priority in ('alta','media','baja')),
  status text not null default 'pendiente' check (status in ('pendiente','en_proceso','completada','cancelada')),
  auto_key text unique, -- idempotencia de tareas automáticas
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_assignee on tasks(assignee_id, status, due_at);
create index tasks_app on tasks(application_id);

-- ===== Agenda =====
create table interview_slots (
  id uuid primary key default gen_random_uuid(),
  interviewer_id uuid not null references users(id),
  vacancy_id uuid references vacancies(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null check (mode in ('presencial','virtual')),
  location text,
  meeting_url text,
  status text not null default 'disponible' check (status in ('disponible','cancelado')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (mode <> 'presencial' or location is not null),
  check (mode <> 'virtual' or meeting_url is not null),
  constraint interview_slots_no_overlap exclude using gist (
    interviewer_id with =, tstzrange(starts_at, ends_at) with &&
  ) where (status <> 'cancelado')
);
create index interview_slots_time on interview_slots(starts_at);

create table interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  slot_id uuid not null references interview_slots(id),
  status text not null default 'agendada' check (status in ('agendada','confirmada','realizada','no_asistio','cancelada','reprogramada')),
  booked_by text not null check (booked_by in ('candidato','reclutador')),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  result text check (result in ('avanza','no_avanza','pendiente')),
  interviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Un horario solo puede tener una cita activa
create unique index interviews_slot_active on interviews(slot_id) where status in ('agendada','confirmada','realizada');
-- Una postulación solo puede tener una cita pendiente a la vez
create unique index interviews_app_pending on interviews(application_id) where status in ('agendada','confirmada');

-- ===== Comunicación =====
create table outbox_messages (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete set null,
  channel text not null check (channel in ('sms','whatsapp','email')),
  destination text not null,
  template_code text not null,
  subject text,
  body text not null,
  status text not null check (status in ('simulado','pendiente','enviado','fallido')),
  provider text not null,
  idempotency_key text unique,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_created on outbox_messages(created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, read_at, created_at desc);

create table duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  matched_candidate_id uuid not null references candidates(id) on delete cascade,
  match_on text not null,
  details jsonb not null default '{}',
  status text not null default 'pendiente' check (status in ('pendiente','misma_persona','personas_distintas')),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  actor_type text not null check (actor_type in ('user','candidate','system')),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index audit_entity on audit_log(entity_type, entity_id, created_at desc);
create index audit_created on audit_log(created_at desc);

-- ===== Datos de catálogo base (no son datos de demostración) =====
insert into pipeline_stages (code, name, position, category, candidate_step, requires_reason, sla_hours) values
 ('nuevo_prospecto','Nuevo prospecto',1,'activo',0,false,24),
 ('registro_iniciado','Registro iniciado',2,'activo',0,false,48),
 ('registro_completado','Registro completado',3,'activo',0,false,24),
 ('precalificacion_pendiente','Precalificación pendiente',4,'activo',1,false,48),
 ('precalificacion_completada','Precalificación completada',5,'activo',1,false,4),
 ('revision_compatibilidad','Revisión de compatibilidad',6,'activo',1,false,24),
 ('contacto_pendiente','Contacto pendiente',7,'activo',2,false,24),
 ('entrevista_agendada','Entrevista inicial agendada',8,'activo',2,false,null),
 ('entrevista_realizada','Entrevista inicial realizada',9,'activo',2,false,24),
 ('evaluacion','Evaluación técnica o psicométrica',10,'activo',3,false,72),
 ('entrevista_supervisor','Entrevista con supervisor o cliente',11,'activo',3,false,72),
 ('validacion_requisitos','Validación de requisitos',12,'activo',3,false,48),
 ('documentacion_pendiente','Documentación pendiente',13,'activo',3,false,72),
 ('oferta','Oferta laboral',14,'activo',4,false,48),
 ('oferta_aceptada','Oferta aceptada',15,'activo',4,false,72),
 ('contratacion_confirmada','Contratación confirmada',16,'contratado',5,false,null),
 ('onboarding','Inducción y onboarding',17,'contratado',5,false,null),
 ('ingreso_efectivo','Ingreso efectivo',18,'contratado',5,false,null),
 ('rechazado','Rechazado',19,'cerrado',0,true,null),
 ('retirado','Retirado por el candidato',20,'cerrado',0,true,null),
 ('no_localizado','No localizado',21,'cerrado',0,true,null),
 ('abandono','Abandono del proceso',22,'cerrado',0,true,null),
 ('reserva','Reserva de talento',23,'reserva',0,true,null);

insert into stage_transitions (from_code, to_code) values
 ('nuevo_prospecto','registro_iniciado'),
 ('registro_iniciado','registro_completado'),
 ('registro_completado','precalificacion_pendiente'),
 ('registro_completado','contacto_pendiente'),
 ('precalificacion_pendiente','precalificacion_completada'),
 ('precalificacion_completada','revision_compatibilidad'),
 ('precalificacion_completada','contacto_pendiente'),
 ('revision_compatibilidad','contacto_pendiente'),
 ('contacto_pendiente','entrevista_agendada'),
 ('entrevista_agendada','entrevista_realizada'),
 ('entrevista_agendada','contacto_pendiente'),
 ('entrevista_realizada','evaluacion'),
 ('entrevista_realizada','entrevista_supervisor'),
 ('entrevista_realizada','validacion_requisitos'),
 ('evaluacion','entrevista_supervisor'),
 ('evaluacion','validacion_requisitos'),
 ('entrevista_supervisor','validacion_requisitos'),
 ('validacion_requisitos','documentacion_pendiente'),
 ('documentacion_pendiente','oferta'),
 ('oferta','oferta_aceptada'),
 ('oferta_aceptada','contratacion_confirmada'),
 ('contratacion_confirmada','onboarding'),
 ('onboarding','ingreso_efectivo'),
 ('reserva','contacto_pendiente'),
 ('abandono','contacto_pendiente'),
 ('no_localizado','contacto_pendiente'),
 ('retirado','contacto_pendiente');
-- Desde cualquier etapa activa se puede cerrar (con motivo)
insert into stage_transitions (from_code, to_code)
select s.code, c.code from pipeline_stages s cross join pipeline_stages c
where s.category = 'activo' and c.code in ('rechazado','retirado','no_localizado','abandono','reserva')
on conflict do nothing;
-- Desde oferta aceptada/contratación aún puede haber retiro
insert into stage_transitions (from_code, to_code) values
 ('contratacion_confirmada','retirado'),('onboarding','retirado'),('onboarding','abandono')
on conflict do nothing;

insert into closure_reasons (stage_code, name) values
 ('rechazado','No cumple requisito indispensable validado'),
 ('rechazado','Resultado de entrevista no favorable'),
 ('rechazado','Resultado de evaluación no favorable'),
 ('rechazado','Documentación no válida'),
 ('retirado','Aceptó otra oferta'),
 ('retirado','Sueldo no le convence'),
 ('retirado','Horario no le conviene'),
 ('retirado','Ubicación / traslado'),
 ('retirado','Motivos personales'),
 ('retirado','Retiro desde el portal'),
 ('no_localizado','No contesta tras 3 intentos'),
 ('no_localizado','Número inválido'),
 ('abandono','No asistió y no respondió'),
 ('abandono','No concluyó registro'),
 ('reserva','Perfil útil para otra vacante'),
 ('reserva','Vacante cubierta');
