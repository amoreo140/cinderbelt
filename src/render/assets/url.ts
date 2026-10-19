/** Full URL of a file from public/ (respects BASE_URL). */
export const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`;
