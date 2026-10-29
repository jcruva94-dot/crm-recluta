export type Role = 'admin' | 'director' | 'gerente' | 'coordinador' | 'reclutador' | 'entrevistador' | 'auditor';

export type Permission =
  | 'config.manage'          // catálogos, usuarios
  | 'vacancy.manage'         // crear/editar vacantes, preguntas, ligas
  | 'vacancy.read'
  | 'application.read'
  | 'application.contact.read' // ver teléfono y correo
  | 'application.move'
  | 'application.assign'
  | 'pipeline.override'
  | 'note.write'
  | 'task.manage'
  | 'schedule.manage'        // crear horarios, agendar por el candidato
  | 'interview.evaluate'     // registrar asistencia/resultado
  | 'export'
  | 'dashboard.read'
  | 'audit.read'
  | 'duplicates.resolve'
  | 'messages.read'
  | 'documents.read'         // descargar archivos personales
  | 'documents.review';      // solicitar y validar documentos

const all: Permission[] = ['config.manage','vacancy.manage','vacancy.read','application.read','application.contact.read','application.move','application.assign','pipeline.override','note.write','task.manage','schedule.manage','interview.evaluate','export','dashboard.read','audit.read','duplicates.resolve','messages.read','documents.read','documents.review'];

export const rolePermissions: Record<Role, Permission[]> = {
  admin: all,
  director: ['vacancy.read','application.read','application.contact.read','export','dashboard.read','audit.read','messages.read'],
  gerente: ['vacancy.manage','vacancy.read','application.read','application.contact.read','application.move','application.assign','pipeline.override','note.write','task.manage','schedule.manage','interview.evaluate','export','dashboard.read','duplicates.resolve','messages.read','documents.read','documents.review'],
  coordinador: ['vacancy.read','application.read','application.contact.read','application.move','application.assign','note.write','task.manage','schedule.manage','interview.evaluate','dashboard.read','duplicates.resolve','messages.read','documents.read','documents.review'],
  reclutador: ['vacancy.read','application.read','application.contact.read','application.move','note.write','task.manage','schedule.manage','interview.evaluate','dashboard.read','documents.read','documents.review'],
  entrevistador: ['application.read','interview.evaluate','note.write'],
  auditor: ['vacancy.read','application.read','dashboard.read','audit.read'],
};

export const can = (role: Role, p: Permission) => rolePermissions[role]?.includes(p) ?? false;

export const roleLabels: Record<Role, string> = {
  admin: 'Administrador del sistema',
  director: 'Director de reclutamiento',
  gerente: 'Gerente de reclutamiento',
  coordinador: 'Coordinador',
  reclutador: 'Reclutador',
  entrevistador: 'Entrevistador',
  auditor: 'Auditor / consulta ejecutiva',
};
