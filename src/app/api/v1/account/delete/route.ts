import { caller } from '@/lib/server/supabase';
import { body, v1 } from '@/lib/server/v1';
import { accountDeleteSchema, deleteAccount } from '@/lib/persist/lifecycle';

// Permanent deletion of the caller's account; body { confirm: "<account email>" }. See deleteAccount for the rules.
export const POST = v1('/api/v1/account/delete', async (req) => deleteAccount(await caller(req), await body(req, accountDeleteSchema)));
