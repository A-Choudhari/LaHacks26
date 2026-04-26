import { useQuery } from '@tanstack/react-query'
import { API_URL } from '../constants'

export interface MPAFeatureCollection {
  type: string
  features: unknown[]
}

export function useMPAData() {
  return useQuery<MPAFeatureCollection>({
    queryKey: ['mpas'],
    queryFn: () => fetch(`${API_URL}/mpas`).then(r => r.json()),
    staleTime: 1000 * 60 * 60 * 24 * 7, // 7 days — boundaries change rarely
    retry: 1,
  })
}
