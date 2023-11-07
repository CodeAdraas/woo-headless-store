import WPAPI from 'wpapi';
// @ts-ignore
import Dinero from 'dinero.js';
import type {Storage, CheckoutData} from './types';

/**
 * WP-JSON WC store API namespace, used for discovery.
 */
export const STORE_API_NAMESPACE = 'wc/store/v1';

export class Store {
    /**
     * Storage object that stores tokens for cart sessions.
     */
    private storage: Storage;

    /**
     * WC store API base URL.
     */
    private apiBaseUrl: string;

    /**
     * Cart session.
     */
    public cart: Cart;

    /**
     * Discovered WC store API namespace.
     */
    api: any;

    /**
     * Indication if underlying `api` is discovered and ready to use.
     * 
     * Could be made reactive on high level.
     */
    public loaded: boolean;

    constructor(storage?: Storage, apiBaseUrl?: string) {
        this.storage = storage || {};
        this.apiBaseUrl = apiBaseUrl || `${location.hostname}/wp-json`;

        this.cart = new Cart(
            this.storage?.wcCartToken,
            this.storage?.wcCartNonce
        );

        // Gets assigned after calling `.init()`.
        this.api = null;
        this.loaded = false;
    }

    /**
     * Discover WP-API and set WC store API namespace.
     */
    public init() {
        WPAPI.discover(this.apiBaseUrl).then(
            (api) => {
                this.api = api.namespace(STORE_API_NAMESPACE);
                this.cart.setStore(this);
                this.loaded = true;
            }
        )
    }

    /**
     * Make a fetch request and apply middleware for cart session tokens.
     */
    public async apiRequest(options: {
        url: string,
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        data?: string | number | boolean | Record<string, any>
    }) {
        const fetchResult = await fetch(options.url, {
            method: options?.method || 'GET',
            body: options?.data ? JSON.stringify(options.data) : null,
            headers: {
                'Content-Type': 'application/json',
                'Cart-Token': this.cart.token,
                'Nonce': this.cart.nonce,
            }
        })

        // Read and store cart session tokens.
        if (fetchResult.headers.has('cart-token')) {
            this.cart.token =
            this.storage.cartToken = this.cart.token
        }
        if (fetchResult.headers.has('nonce')) {
            this.cart.nonce = fetchResult.headers.get('nonce')
            this.storage.cartNonce = this.cart.nonce
        }

        // Set cart session tokens
        this.cart.setTokens(
            fetchResult.headers.get('cart-token'),
            fetchResult.headers.get('nonce')
        );

        // Update storage
        this.storage.wcCartToken = fetchResult.headers.get('cart-token')
            ? fetchResult.headers.get('cart-token')
            : this.storage.wcCartToken
        this.storage.wcCartNone = fetchResult.headers.get('nonce')
            ? fetchResult.headers.get('nonce')
            : this.storage.wcCartNone

        // Return JSON data
        return await fetchResult.json();
    }
}

export class Cart {
    /**
     * WC cart session token.
     */
    public token?: string;

    /**
     * WC cart session nonce.
     */
    public nonce?: string;

    /**
     * Cart line items.
     */
    public items: CartLineItem[];

    /**
     * Store instance.
     */
    store: Store;

    /**
     * Indication wheter cart is initialized. Meaning if the current
     * loaded cart session is up-to-date.
     */
    private isInit: any;

    /**
     * Indication wheter cart is busy calling the API.
     */
    loading: boolean;

    constructor(token?: string, nonce?: string) {
        this.token = token;
        this.nonce = nonce;

        this.items = [];

        this.store = null;
        this.isInit = false;
        this.loading = true;
    }

    /**
     * Cart currency code.
     */
    get currency() {
        if (!this.items.length) return null;
        return this.items[0].currencyCode;
    }

    /**
     * Cart subtotal Dinero price.
     */
    get subtotal() {
        if (!this.items.length) return null;

        let subtotal = 0;
        for (const lineItem of this.items) {
            subtotal += lineItem.subtotal;
        }

        return Dinero({
            amount: subtotal,
            currency: this.currency
        });
    }

    
    /*
     * Cart total tax amount.
     */
    get tax() {
        if (!this.items.length) return null;

        let tax = 0;
        for (const lineItem of this.items) {
            tax += lineItem.tax;
        }

        return Dinero({
            amount: tax,
            currency: this.currency
        });
    }

    /*
     * Cart total amount.
     */
    get total() {
        if (!this.items.length) return null;

        let total = 0;
        for (const lineItem of this.items) {
            total += lineItem.total;
        }

        return Dinero({
            amount: total,
            currency: this.currency
        });
    }

    /**
     * Set Store instance.
     */
    public setStore(store: Store) {
        this.store = store;
    }

    /**
     * Exclusively set provided cart session tokens.
     */
    public setTokens(token?: string, nonce?: string) {
        this.token = token ? token : this.token;
        this.nonce = nonce ? nonce : this.nonce;
    }

    /**
     * Initialize cart. Loads current cart session or creates a new one.
     */
    public async init() {
        // Return ready to use API, already initialized.
        if (this.isInit) return {
            api: this.store.api
        };

        this.markLoading();

        const cart = await this.store.apiRequest({
            url: this.store.api.cart().toString()
        });

        // Now all the mandatory fetching is done, we can set
        // 'isInit' to true and 'loading' to false.
        this.isInit = true;
        this.loading = false;

        this.setLineItems(cart.items);

        this.markNotLoading();

        // Return ready to use API.
        return {
            api: this.store.api
        };
    }

    /**
     * Get a cart item by key. Returns null if item provided key
     * does not resolve.
     */
    public item(key: any) {
        let search = this.items.filter(
            lineItems => lineItems.key === key
        );
        return search[0] ?? null;
    }

    /**
     * Add a new lineitem. If a duplicate line item is provided, it
     * increments the existing line item.
     */
    public async add(lineItem: any) {
        const {api} = await this.init()
        this.markLoading()
        await this.store.apiRequest({
            url: api.cart().addItem().toString(),
            method: 'POST',
            data: lineItem
        });
        await this.refresh();
        this.markNotLoading();
    }

    /**
     * Clear all line items.
     */
    public async clear() {
        const {api} = await this.init()
        this.markLoading()
        await this.store.apiRequest({
            url: api.cart().items().toString(),
            method: 'DELETE'
        });
        await this.refresh();
        this.markNotLoading();
    }

    /**
     * Refresh cart. Sets (new) line items.
     */
    public async refresh() {
        const {api} = await this.init();
        this.markLoading();
        let cart = await this.store.apiRequest({
            url: api.cart().toString()
        });
        this.setLineItems(cart.items);
        this.markNotLoading();
    }

    /**
     * Checkout with current cart and return payment redirect URL.
     */
    public async checkout(data: CheckoutData): Promise<string>
    {
        const {api} = await this.init();
        this.markLoading();
        let checkout = await this.store.apiRequest({
            url: api.checkout().toString(),
            method: 'POST',
            data
        });
        this.markNotLoading();
        return checkout.payment_result.redirect_url;
    }

    private setLineItems(lineItems: any[]) {
        this.items = [];
        lineItems?.forEach((lineItem: any) => this.addLineItem(lineItem));
    }

    private addLineItem(data: any) {
        let lineItem = new CartLineItem(
            data.id,
            data.key,
            data.name,
            data.images,
            data.quantity,
            this.currency,
            data.totals.currency_symbol,
            parseInt(data.prices.price),
            parseInt(data.totals.line_subtotal),
            parseInt(data.totals.line_total_tax),
            parseInt(data.totals.line_total),
            this
        );
        this.items.push(lineItem);
        return lineItem;
    }

    public markLoading() {
        this.loading = true;
    }

    public markNotLoading() {
        this.loading = false;
    }
}

export class CartLineItem {
    /**
     * Cart item key.
     */
    key: any;

    /**
     * Product ID.
     */
    id: any;

    /**
     * Product name.
     */
    name: any;

    /**
     * Product images.
     */
    images: any;

    /**
     * Product cart quantity.
     */
    quantity: any;

    /**
     * Cart item currency code e.g. EUR.
     */
    currencyCode: string;

    /**
     * Cart item currenct symbol e.g. €.
     */
    currencySymbol: any;

    /**
     * Cart item price.
     */
    price: any;

    /**
     * Cart item subtotal.
     */
    subtotal: any;

    /**
     * Cart item total tax amount.
     */
    tax: any;

    /**
     * Cart item total amount.
     */
    total: any;

    private cart: Cart;

    constructor(
        id: any,
        key: any,
        name: any,
        images: any,
        quantity: any,
        currencyCode: any,
        currencySymbol: any,
        price: any,
        subtotal: any,
        tax: any,
        total: any,
        cart: any
    ) {
        this.id = id
        this.key = key
        this.name = name
        this.images = images
        this.quantity = quantity
        this.currencyCode = currencyCode;
        this.currencySymbol = currencySymbol
        
        this.price = Dinero({amount: price, currency: currencyCode})
        this.subtotal = Dinero({amount: subtotal, currency: currencyCode})
        this.tax = Dinero({amount: tax, currency: currencyCode})
        this.total = Dinero({amount: total, currency: currencyCode})

        this.cart = cart
    }

    /**
     * Increase quantity of current cart item.
     */
    async increase() {
        const {api} = await this.cart.init()
        await this.cart.store.apiRequest({
            url: api
                .cart()
                .items(this.key),
            method: 'PATCH',
            data: {quantity: this.quantity + 1}
        })
    }

    /**
     * Decrease quantity of current cart item. If
     * result will be 0, remove item from cart.
     */
    async decrease() {
        const {api} = await this.cart.init()
        if (this.quantity - 1 <= 0) {
            await this.remove()
        }
        else {
            await this.cart.store.apiRequest({
                url: api
                    .cart()
                    .items(this.key),
                method: 'PATCH',
                data: {quantity: this.quantity - 1}
            })
        }
    }

    /**
     * Remove item from cart.
     */
    async remove() {
        const {api} = await this.cart.init()
        await this.cart.store.apiRequest({
            url: api
                .cart()
                .items(this.key),
            method: 'DELETE'
        })
    }
}