import { describe, it, expect } from 'vitest';
import { staff, compatibleCandidate, applyCandidate, multipart, fakePdf, pool } from './helpers.js';

async function typeIds(codes: string[]) {
  return (await pool.query('select id from document_types where code = any($1) order by position', [codes])).rows.map((r) => r.id);
}

describe('documentos en PDF', () => {
  it('flujo completo: solicitar → subir PDF → corrección → nueva versión → aprobar', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    const req = await r.post(`/api/admin/applications/${c.applicationId}/documents`, { documentTypeIds: await typeIds(['ine', 'curp']) });
    expect(req.status).toBe(200);
    expect(req.body.requested).toBe(2);

    let view = (await c.agent.get(`/api/portal/applications/${c.applicationId}`)).body;
    expect(view.documents).toHaveLength(2);
    expect(view.documents.every((d: any) => d.canUpload)).toBe(true);
    const ine = view.documents.find((d: any) => d.name.includes('INE'));

    const mp = multipart('Mi INE (frente).pdf', fakePdf('v1'));
    const up = await c.agent.req('POST', `/api/portal/documents/${ine.id}/file`, mp.body, mp.headers);
    expect(up.status).toBe(200);
    expect(up.body.version).toBe(1);
    expect(up.body.application.documents.find((d: any) => d.id === ine.id).status).toBe('recibido');
    // Ya en revisión: no se puede volver a subir
    const again = await c.agent.req('POST', `/api/portal/documents/${ine.id}/file`, mp.body, mp.headers);
    expect(again.status).toBe(400);
    // Se creó tarea de validación para el reclutador
    const t = (await pool.query(`select count(*)::int n from tasks where application_id = $1 and type = 'validar_documentos' and status = 'pendiente'`, [c.applicationId])).rows[0].n;
    expect(t).toBe(1);

    // Corrección exige motivo
    expect((await r.post(`/api/admin/documents/${ine.id}/review`, { status: 'requiere_correccion' })).status).toBe(400);
    expect((await r.post(`/api/admin/documents/${ine.id}/review`, { status: 'requiere_correccion', reason: 'La imagen está borrosa, falta el reverso' })).status).toBe(200);
    view = (await c.agent.get(`/api/portal/applications/${c.applicationId}`)).body;
    const ine2 = view.documents.find((d: any) => d.id === ine.id);
    expect(ine2.correction).toContain('borrosa');
    expect(ine2.canUpload).toBe(true);

    const mp2 = multipart('ine.pdf', fakePdf('v2'));
    const up2 = await c.agent.req('POST', `/api/portal/documents/${ine.id}/file`, mp2.body, mp2.headers);
    expect(up2.body.version).toBe(2);
    const ok = await r.post(`/api/admin/documents/${ine.id}/review`, { status: 'aprobado', expiresAt: '2030-12-31' });
    expect(ok.status).toBe(200);
    expect(ok.body.allApproved).toBe(false); // falta la CURP

    // El reclutador descarga la versión vigente y la anterior; queda auditado
    const dl = await r.get(`/api/admin/documents/${ine.id}/file`);
    expect(dl.status).toBe(200);
    expect(dl.raw.headers['content-type']).toBe('application/pdf');
    expect(dl.raw.body).toContain('v2');
    const v1 = await r.get(`/api/admin/documents/${ine.id}/file?version=1`);
    expect(v1.raw.body).toContain('v1');
    const audited = (await pool.query(`select count(*)::int n from audit_log where action = 'document.download' and entity_id = $1`, [c.applicationId])).rows[0].n;
    expect(audited).toBe(2);
    // Los archivos no se pueden subir de nuevo una vez aprobados
    expect((await c.agent.req('POST', `/api/portal/documents/${ine.id}/file`, mp2.body, mp2.headers)).status).toBe(400);
  });

  it('rechaza archivos que no son PDF real y archivos de más de 5 MB', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    await r.post(`/api/admin/applications/${c.applicationId}/documents`, { documentTypeIds: await typeIds(['curp']) });
    const doc = (await c.agent.get(`/api/portal/applications/${c.applicationId}`)).body.documents[0];
    // Imagen renombrada como .pdf
    const fake = multipart('curp.pdf', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    const bad = await c.agent.req('POST', `/api/portal/documents/${doc.id}/file`, fake.body, fake.headers);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/no es un PDF/);
    const big = multipart('grande.pdf', Buffer.concat([fakePdf(), Buffer.alloc(5 * 1024 * 1024 + 10, 32)]));
    const tooBig = await c.agent.req('POST', `/api/portal/documents/${doc.id}/file`, big.body, big.headers);
    expect(tooBig.status).toBe(413);
    const n = (await pool.query('select count(*)::int n from document_files where document_id = $1', [doc.id])).rows[0].n;
    expect(n).toBe(0);
  });

  it('nadie fuera del expediente puede subir ni descargar', async () => {
    const c = await compatibleCandidate();
    const r = await staff('reclutador1@demo.test');
    await r.post(`/api/admin/applications/${c.applicationId}/documents`, { documentTypeIds: await typeIds(['rfc']) });
    const doc = (await c.agent.get(`/api/portal/applications/${c.applicationId}`)).body.documents[0];
    const mp = multipart('rfc.pdf', fakePdf());
    await c.agent.req('POST', `/api/portal/documents/${doc.id}/file`, mp.body, mp.headers);

    const other = await applyCandidate();
    expect((await other.agent.req('POST', `/api/portal/documents/${doc.id}/file`, mp.body, mp.headers)).status).toBe(404);
    expect((await other.agent.get(`/api/portal/documents/${doc.id}/file`)).status).toBe(404);
    expect((await c.agent.get(`/api/portal/documents/${doc.id}/file`)).status).toBe(200);

    expect((await (await staff('reclutador3@demo.test')).get(`/api/admin/documents/${doc.id}/file`)).status).toBe(404); // otro equipo
    expect((await (await staff('entrevistador@demo.test')).get(`/api/admin/documents/${doc.id}/file`)).status).toBe(403);
    expect((await (await staff('auditor@demo.test')).get(`/api/admin/documents/${doc.id}/file`)).status).toBe(403);
    expect((await (await staff('director@demo.test')).post(`/api/admin/documents/${doc.id}/review`, { status: 'aprobado' })).status).toBe(403);
  });

  it('al pasar a "Documentación pendiente" se solicitan los documentos de la vacante', async () => {
    const c = await compatibleCandidate();
    const g = await staff('gerente@demo.test');
    const mv = await g.post(`/api/admin/applications/${c.applicationId}/move`, { toStage: 'documentacion_pendiente', expectedStage: 'contacto_pendiente', override: true, reason: 'Prueba de documentos automáticos' });
    expect(mv.status).toBe(200);
    const view = (await c.agent.get(`/api/portal/applications/${c.applicationId}`)).body;
    expect(view.documents.map((d: any) => d.name).length).toBe(5);
    expect(view.nextStep).toBe('documentos');
    expect(view.stage.title).toBe('Sube tus documentos');
  });

  it('el portal informa la vacante de cada postulación (para mostrar el estatus en la liga)', async () => {
    const c = await applyCandidate();
    const me = (await c.agent.get('/api/portal/me')).body;
    const vid = (await pool.query(`select id from vacancies where slug = 'asesor-ventas-telefonicas'`)).rows[0].id;
    expect(me.applications[0].vacancyId).toBe(vid);
    expect(me.applications[0].status).toBeTruthy();
  });
});
