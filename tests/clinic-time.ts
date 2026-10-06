import { beirutDateTimeToUtc } from '../src/utils/timezone.js';
/** Fixtures expressed in clinic wall time, stored as real UTC. */
export const clinicIso = (value: string) => beirutDateTimeToUtc(value.slice(0,10),value.slice(11,16)).toISOString();
