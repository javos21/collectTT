export const STORE_APPLICATION_TERMS_VERSION = '2026-08-30';

export const STORE_APPLICATION_RESPONSIBILITIES = [
  'I am authorized to apply on behalf of this Store and will keep the Store information accurate.',
  'I will only accept items with a valid CollectTT drop-off record or code.',
  'I will keep accepted items secure and follow CollectTT payment-gated release instructions.',
  'I will not release an item until the Store workspace shows that it is cleared for pickup.',
  'I will follow shelf-time limits and cooperate with return or overstay instructions.',
  'I will promptly report changes to the Store address, contacts, staff, or ability to hold inventory.',
  'I understand CollectTT may suspend Store access for unsafe custody, false information, or misuse.',
] as const;

export const STORE_APPLICATION_LEGAL_COPY =
  'Store approval makes this location part of CollectTT\'s custody workflow. The Store is responsible for maintaining a safe, secure place for accepted items, following the custody record, and complying with applicable laws, insurance requirements, and its own customer-facing policies. CollectTT may review, pause, or remove Store access when these responsibilities are not met. This application is not approval, and submitting it does not create a guarantee of Store access, inventory, sales, or payment.';
