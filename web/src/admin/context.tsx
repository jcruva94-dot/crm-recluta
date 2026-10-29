import { createContext, useContext } from 'react';

export interface Me {
  user: { id: string; fullName: string; email: string; role: string; roleLabel: string; teamId: string | null };
  permissions: string[];
  deliveryMode: string;
  publicBaseUrl: string;
}
export interface Catalogs {
  clients: any[]; campaigns: any[]; sites: any[]; sources: any[]; stages: any[]; users: any[]; teams: any[]; closureReasons: any[]; transitions: { from_code: string; to_code: string }[]; documentTypes: any[];
}
export const AdminCtx = createContext<{ me: Me; catalogs: Catalogs; can: (p: string) => boolean; reloadCatalogs: () => void } | null>(null);
export const useAdmin = () => {
  const c = useContext(AdminCtx);
  if (!c) throw new Error('AdminCtx');
  return c;
};
