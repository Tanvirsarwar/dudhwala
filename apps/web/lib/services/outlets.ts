import { api } from '../api';
import type { Outlet, OutletService } from './types';

/** Outlets come from the mock API's /outlets (existing demo outlet data). Phase 2: the real outlets endpoint. */
export const outletService: OutletService = { list: () => api<Outlet[]>('/outlets') };
