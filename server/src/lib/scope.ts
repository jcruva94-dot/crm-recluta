import type { Role } from './permissions.js';

export interface StaffUser {
  id: string;
  role: Role;
  teamId: string | null;
  fullName: string;
  email: string;
}

/**
 * Devuelve una condición SQL que restringe las postulaciones (alias `a`) al alcance del usuario.
 * Los parámetros se agregan al arreglo `params` recibido.
 */
export function applicationScope(user: StaffUser, params: unknown[], alias = 'a'): string {
  switch (user.role) {
    case 'admin':
    case 'director':
    case 'auditor':
      return 'true';
    case 'gerente':
    case 'coordinador':
      params.push(user.teamId);
      return `${alias}.vacancy_id in (select id from vacancies where team_id = $${params.length})`;
    case 'reclutador':
      params.push(user.id);
      return `(${alias}.recruiter_id = $${params.length} or ${alias}.vacancy_id in (select vacancy_id from vacancy_recruiters where user_id = $${params.length}))`;
    case 'entrevistador':
      params.push(user.id);
      return `${alias}.id in (select i.application_id from interviews i join interview_slots s on s.id = i.slot_id where s.interviewer_id = $${params.length})`;
    default:
      return 'false';
  }
}

export function vacancyScope(user: StaffUser, params: unknown[], alias = 'v'): string {
  switch (user.role) {
    case 'admin':
    case 'director':
    case 'auditor':
      return 'true';
    case 'gerente':
    case 'coordinador':
      params.push(user.teamId);
      return `${alias}.team_id = $${params.length}`;
    case 'reclutador':
      params.push(user.id);
      return `${alias}.id in (select vacancy_id from vacancy_recruiters where user_id = $${params.length})`;
    default:
      return 'false';
  }
}
