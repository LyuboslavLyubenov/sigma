import type { Money, RiskBand } from '@sigma/shared';

export interface TenderSummary {
  id: string;
  title: string;
  authorityName: string;
  estimatedValue: Money | null;
  status: string;
  riskScore: number | null;
  riskBand: RiskBand | null;
  publishedAt: string | null;
}

export interface TenderDetail extends TenderSummary {
  cpvCode: string | null;
  procedureType: string;
  deadlineAt: string | null;
  signals: Record<string, number> | null;
}

export interface SearchTendersQuery {
  q?: string;
  status?: string;
  minRisk?: number;
  limit?: number;
  cursor?: string;
}

export interface SearchTendersResponse {
  results: TenderSummary[];
  cursor: string | null;
}

export interface ApiError {
  error: string;
  message: string;
}

export const API_ROUTES = {
  searchTenders: '/api/tenders',
  tenderDetail: (id: string) => `/api/tenders/${id}`,
  riskScore: (id: string) => `/api/tenders/${id}/risk`,
  openData: '/api/open-data/tenders.json',
} as const;
