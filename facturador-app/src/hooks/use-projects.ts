import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
import { externalSupabase } from '@/lib/external-supabase';
import { ProjectRecord, ProjectStatus } from '@/lib/accounting-types';
import { describeSupabaseError } from '@/lib/accounting-service';

export function useProjects() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      
      // 1. Extraemos proyectos de Cerezo
      const { data: extData, error: extError } = await externalSupabase
        .from('projects')
        .select('id, name, client, status, income, startDate')
        .order('id', { ascending: false });

      if (extError) throw extError;

      // 2. Extraemos el estado de facturación local
      const { data: localData, error: localError } = await supabase
        .from('projects')
        .select('id, billing_status');

      if (localError) throw localError;

      const localMap = new Map((localData as any[]).map(row => [row.id, row.billing_status]));

      const mapped: ProjectRecord[] = (extData as any[]).map((row) => {
        return {
          id: row.id,
          name: row.name || 'Sin nombre',
          clientId: null,
          clientName: row.client || 'Sin cliente',
          description: '',
          status: 'completado', // Dummy status
          billingStatus: localMap.get(row.id) || 'pendiente',
          expectedAmount: row.income || 0,
          dueDate: row.startDate || null,
        };
      });

      setProjects(mapped);
      setError(null);
    } catch (err) {
      setError(describeSupabaseError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const addProject = async (project: ProjectRecord) => {
    alert("Los proyectos se sincronizan desde Cerezo. No se pueden crear aquí.");
  };

  const updateProject = async (id: string, project: Partial<ProjectRecord>) => {
    if (project.billingStatus) {
      const extProject = projects.find(p => p.id === id);
      const { error: updateError } = await supabase.from('projects').upsert({
        id,
        name: extProject?.name || 'Sync',
        billing_status: project.billingStatus,
        status: 'completado'
      });
      if (updateError) throw updateError;
      
      setProjects(prev => prev.map(p => p.id === id ? { ...p, billingStatus: project.billingStatus! } : p));
    }
  };

  const deleteProject = async (id: string) => {
    alert("No puedes eliminar proyectos de Cerezo desde el facturador.");
  };

  return {
    projects,
    loading,
    error,
    fetchProjects,
    addProject,
    updateProject,
    deleteProject,
  };
}
