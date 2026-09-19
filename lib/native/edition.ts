import { isIOS } from "@/lib/native/platform";

/** The shipping iOS edition is the basic game until StoreKit is implemented.
 * This applies to every iOS account, including operators and existing subscribers.
 * It must never be used to rewrite an account's purchased entitlements or saves.
 */
export const isIOSFreeEdition = (): boolean => isIOS();

export const IOS_EDITION_NOTE =
  "This iOS edition includes the basic game. Purchases and additional paid content are not available in this edition.";

export const IOS_EXISTING_SUBSCRIPTION_NOTE =
  "Installing this edition does not cancel an existing subscription. Your subscription and saved companies are unchanged. Contact support for help with your existing subscription.";

export const IOS_SAVED_COMPANY_NOTE =
  "This company uses content or a company slot that is not available in this iOS edition. Its saved progress is kept unchanged.";
