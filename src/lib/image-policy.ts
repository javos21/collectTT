/** Shared image intake limits for the browser, web process, and worker. */
export const UPLOAD_CONTENT_TYPE = 'image/webp';
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 2400;
export const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;

/** Quality for the pre-R2 browser encode. The worker applies its own variant quality. */
export const SOURCE_WEBP_QUALITY = 0.88;
