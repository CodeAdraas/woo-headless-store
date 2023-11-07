export * from './wooCommerce'
import type {LineItem} from './wooCommerce'

export interface HeadlessStoreCartLineItem {
    id: string;
    key: string;
    name: string;
    images: string;
    quantity: number;
    currencySymbol: string
    price: string;
    subtotal: string;
    total: number;
    tax: number;
    increase(): void;
    decrease(): void;
    remove(): void;
}

export interface HeadlessStoreCart {
    create(): HeadlessStoreCart;
    token: string;
    expires: number;
    lineItems: HeadlessStoreCartLineItem[];
    currency: string
    subtotal: string;
    tax: string;
    total: string;
    loading: boolean;
    add(lineItem: LineItem): HeadlessStoreCartLineItem;
    item(key: string): HeadlessStoreCartLineItem | null;
    clear(): void;
}

// - Check if cart key is in storge
// - Check if cart is valid, else create new cart and save cart key
// - No kart key? Create new cart and save cart key
export interface HeadlessStore {
    /** State storage */
    storage: Record<string, any>;
    apiBaseUrl: string;
    storeBaseUrl: string;
    storeCheckoutPage: string;
    cart: HeadlessStoreCart;
    loaded: boolean;
    /**
     * Redirect customer to checkout
     * @param waitFor Promise to await before redirecting customer.
     */
    toCheckout(waitFor: Promise<void>): void;
}

/**
 * A simple storage object. Could be a reactive proxy to localstorage.
 */
export type Storage = {
    wcCartToken?: string;
    wcCartNonce?: string;
    [key: string]: string | number | boolean;
};