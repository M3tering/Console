import { AsyncLocalStorage } from 'async_hooks';
import type { TransactionRecord } from '../types';

export interface ManagedBillingContext { id:string; distribution:TransactionRecord[] }
export const managedBilling = new AsyncLocalStorage<ManagedBillingContext>();
