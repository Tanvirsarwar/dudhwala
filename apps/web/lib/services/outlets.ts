import { api } from '../api';
import type { Outlet, OutletService } from './types';

/** Outlets a customer can pick up from: GET /outlets (active outlets only). */
export const outletService: OutletService = { list: () => api<Outlet[]>('/outlets') };
