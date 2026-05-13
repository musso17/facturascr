'use client';

import { useState, useMemo } from 'react';
import { FolderKanban, CheckCircle2, Circle } from 'lucide-react';
import { useProjects } from '@/hooks/use-projects';
import { ProjectRecord } from '@/lib/accounting-types';
import { toMonthKey, formatMonthLabel } from '@/lib/accounting-service';

export default function ProyectosPage() {
  const { projects, loading, error, updateProject } = useProjects();
  const [monthFilter, setMonthFilter] = useState<string>('todos');

  // Construir opciones de meses basados en la fecha de inicio
  const monthOptions = useMemo(() => {
    const months = new Set<string>();
    projects.forEach((p) => {
      if (p.dueDate) months.add(toMonthKey(p.dueDate));
    });
    return Array.from(months)
      .sort((a, b) => b.localeCompare(a))
      .map((m) => ({ value: m, label: formatMonthLabel(m) }));
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (monthFilter === 'todos') return true;
      if (!p.dueDate) return monthFilter === 'sin_fecha';
      return toMonthKey(p.dueDate) === monthFilter;
    });
  }, [projects, monthFilter]);

  const toggleBillingStatus = async (project: ProjectRecord) => {
    const newStatus = project.billingStatus === 'facturado' ? 'pendiente' : 'facturado';
    try {
      await updateProject(project.id, { billingStatus: newStatus });
    } catch (error: any) {
      console.error(error);
      alert('Error al actualizar el estado: ' + (error.message || JSON.stringify(error)));
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FolderKanban className="w-7 h-7 text-indigo-600" />
            Proyectos
          </h1>
          <p className="text-gray-500 mt-1">
            Proyectos centralizados de Cerezo. Marca los que ya han sido facturados.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex gap-4 items-center">
        <div className="flex flex-col">
          <label className="text-xs font-medium text-gray-500 mb-1">Filtrar por Mes</label>
          <select 
            className="border-gray-200 rounded-lg text-sm focus:ring-black focus:border-black"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
          >
            <option value="todos">Todos los meses</option>
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="sin_fecha">Sin fecha asignada</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Cargando proyectos...</div>
      ) : error ? (
        <div className="text-center py-10 text-red-500">Error: {error}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {filteredProjects.length === 0 ? (
              <li className="p-8 text-center text-gray-500">
                No se encontraron proyectos para este filtro.
              </li>
            ) : (
              filteredProjects.map((project) => {
                const isFacturado = project.billingStatus === 'facturado';
                
                return (
                  <li key={project.id} className="flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 transition-colors">
                    <div>
                      <h3 className="font-bold text-gray-900 text-lg">{project.name}</h3>
                      <p className="text-gray-600 text-sm">{project.clientName}</p>
                    </div>
                    
                    <button
                      onClick={() => toggleBillingStatus(project)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors border ${
                        isFacturado 
                          ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' 
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {isFacturado ? (
                        <>
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                          Facturado
                        </>
                      ) : (
                        <>
                          <Circle className="w-5 h-5 text-gray-400" />
                          Pendiente
                        </>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
