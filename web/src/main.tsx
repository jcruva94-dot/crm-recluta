import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { VacancyLanding, VacancyList } from './candidate/Landing';
import { ApplicationPage, PortalHome, PortalLogin } from './candidate/Portal';
import { AdminLayout } from './admin/Layout';
import { AdminLogin } from './admin/Login';
import { Dashboard } from './admin/Dashboard';
import { Pipeline } from './admin/Pipeline';
import { ApplicationDetail } from './admin/ApplicationDetail';
import { Vacancies, VacancyEdit } from './admin/Vacancies';
import { Agenda, Audit, Duplicates, Messages, Tasks } from './admin/Operations';

function NotFound() {
  return <div className="p-10 text-center"><h1 className="text-xl font-bold">Página no encontrada</h1><a className="text-brand-700 underline" href="/empleo">Ir a vacantes</a></div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/empleo" replace />} />
        <Route path="/empleo" element={<VacancyList />} />
        <Route path="/empleo/l/:code" element={<VacancyLanding />} />
        <Route path="/empleo/v/:slug" element={<VacancyLanding />} />
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/ingresar" element={<PortalLogin />} />
        <Route path="/portal/postulacion/:id" element={<ApplicationPage />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="tareas" element={<Tasks />} />
          <Route path="pipeline" element={<Pipeline />} />
          <Route path="postulaciones/:id" element={<ApplicationDetail />} />
          <Route path="vacantes" element={<Vacancies />} />
          <Route path="vacantes/:id" element={<VacancyEdit />} />
          <Route path="agenda" element={<Agenda />} />
          <Route path="mensajes" element={<Messages />} />
          <Route path="duplicados" element={<Duplicates />} />
          <Route path="auditoria" element={<Audit />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
