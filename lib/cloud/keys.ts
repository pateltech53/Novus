/**
 * Storage keys shared by the two halves of cloud persistence.
 *
 * Small file, specific reason: lib/cloud/sync.ts imports lib/cloud/billing.ts
 * (to adopt entitlements on boot), and billing.ts needs the same restore flag
 * (to clear it when a player comes back from Stripe). Importing back the other
 * way would be a cycle, and writing the string twice would be a bug waiting
 * for someone to rename one of them.
 */

/** Guards the boot restore's reload so it happens at most once per tab. */
export const RESTORED_FLAG = "novus:cloud-restored";
