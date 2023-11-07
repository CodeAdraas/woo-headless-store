export * from './wooCommerce';

/**
 * A simple storage object. Could be a reactive proxy to localstorage.
 */
export type Storage = {
    wcCartToken?: string;
    wcCartNonce?: string;
    [key: string]: string | number | boolean;
};