-- Módulo de documentación: tipos, solicitudes por postulación y archivos versionados (PDF)
create table document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  instructions text,
  has_expiry boolean not null default false,
  is_active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table vacancy_document_types (
  vacancy_id uuid not null references vacancies(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete restrict,
  primary key (vacancy_id, document_type_id)
);

create table application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  document_type_id uuid not null references document_types(id) on delete restrict,
  status text not null default 'solicitado' check (status in ('no_solicitado','solicitado','recibido','en_revision','aprobado','requiere_correccion','rechazado','vencido')),
  requested_at timestamptz not null default now(),
  requested_by uuid references users(id),
  received_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references users(id),
  rejection_reason text,
  expires_at date,
  current_version int not null default 0,
  unique (application_id, document_type_id)
);
create index application_documents_status on application_documents(status);

-- Archivos: se guardan en la base (bytea) para no depender de un almacenamiento externo en la fase de pruebas.
-- Para producción se recomienda moverlos a un bucket privado con URLs firmadas (ver docs/PENDIENTES.md).
create table document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references application_documents(id) on delete cascade,
  version int not null,
  filename text not null,
  mime text not null check (mime = 'application/pdf'),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  sha256 text not null,
  content bytea not null,
  uploaded_at timestamptz not null default now(),
  unique (document_id, version)
);

insert into document_types (code, name, instructions, has_expiry, position) values
 ('ine', 'Identificación oficial (INE)', 'PDF de tu INE por ambos lados, legible y vigente.', true, 1),
 ('curp', 'CURP', 'Descárgala gratis en gob.mx/curp como PDF.', false, 2),
 ('comprobante_domicilio', 'Comprobante de domicilio', 'Recibo de luz, agua, teléfono o predial con antigüedad máxima de 3 meses.', false, 3),
 ('acta_nacimiento', 'Acta de nacimiento', 'Puedes descargarla en gob.mx/actas.', false, 4),
 ('rfc', 'Constancia de situación fiscal (RFC)', 'Descárgala del portal del SAT.', false, 5),
 ('nss', 'Número de Seguridad Social (IMSS)', 'Constancia de NSS descargable en imss.gob.mx.', false, 6),
 ('comprobante_estudios', 'Comprobante de estudios', 'Certificado o constancia del último grado de estudios.', false, 7),
 ('cv', 'Solicitud de empleo o CV', 'Opcional si ya llenaste tu registro.', false, 8);

-- La vacante de demostración (si existe) solicita los documentos básicos
insert into vacancy_document_types (vacancy_id, document_type_id)
select v.id, d.id from vacancies v cross join document_types d
where v.slug = 'asesor-ventas-telefonicas' and d.code in ('ine','curp','comprobante_domicilio','nss','comprobante_estudios');
