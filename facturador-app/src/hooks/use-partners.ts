'use client';

import { useCallback, useEffect, useState } from 'react';
import { PartnerRecord, SupabasePartnerRow } from '@/lib/accounting-types';
import { supabase } from '@/lib/supabase-client';

export function usePartners() {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const mapPartner = useCallback((row: SupabasePartnerRow): PartnerRecord => {
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      tradeName: row.trade_name,
      documentType: row.document_type,
      documentNumber: row.document_number,
      email: row.email,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
    };
  }, []);

  const loadPartners = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase.from('partners').select('*').order('name');
    setPartners((data ?? []).map(mapPartner));
    setIsLoading(false);
  }, [mapPartner]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadPartners();
    }, 0);
    return () => clearTimeout(handle);
  }, [loadPartners]);

  return { partners, isLoading, refresh: loadPartners };
}
