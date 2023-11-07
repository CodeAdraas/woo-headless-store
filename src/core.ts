import WPAPI from 'wpapi'
import Dinero from 'dinero.js';
import type {CheckoutData} from './types'

const STORE_API_NAMESPACE = 'wc/store/v1'
export const CART_EXP_OFFSET = 3600 * 48

export class Store {
    storage: any
    apiBaseUrl: any
    storeBaseUrl: any
    storeCheckoutPage: any
    cart: Cart
    api: any
    private _storeApi: any
    loaded: boolean

    constructor(storage: any, apiBaseUrl: any, storeBaseUrl: any) {
        this.storage = storage
        this.apiBaseUrl = apiBaseUrl
        this.storeBaseUrl = storeBaseUrl

        // Create new cart
        if (Cart.expired(storage?.cartExp || 0)) {
            this.cart = Cart.create()
        }
        // Proceed with saved cart
        else {
            this.cart = new Cart(
                storage.cartToken,
                storage.cartNonce,
                storage.cartExp
            )
        }

        this.api = null
        this._storeApi = null
        this.loaded = false
    }

    init() {
        WPAPI.discover(this.apiBaseUrl).then(
            (api) => {
                this.api = api
                this._storeApi = this.api.namespace(STORE_API_NAMESPACE)
                this.cart.setStore(this)
                this.loaded = true
            }
        )
    }

    get storeApi() {
        return this._storeApi
    }

    /**
     * Make a fetch request that checks for new cart token and/or nonces.
     */
    public async apiRequest(options: {url: any, method?: any, data?: any}) {
        const res = await fetch(options.url, {
            method: options?.method || 'GET',
            body: options?.data ? JSON.stringify(options.data) : null,
            headers: {
                'Content-Type': 'application/json',
                'Cart-Token': this.cart.token,
                'Nonce': this.cart.nonce,
            }
        })
        let data = null
        try {
            data = await res.json()
        }
        catch(e) {}
        // Read tokens and store tokens
        if (res.headers.has('cart-token'))
            this.cart.token = res.headers.get('cart-token')
            this.storage.cartToken = this.cart.token
        if (res.headers.has('nonce'))
            this.cart.nonce = res.headers.get('nonce')
            this.storage.cartNonce = this.cart.nonce
        // Return JSON data
        return data
    }
}

export class Cart {
    token: any
    expires: any
    nonce: any
    lineItems: CartLineItem[]
    currency: any
    subtotal: any;
    tax: any;
    total: any;
    store: any
    private isInit: any
    loading: boolean

    constructor(token: any, nonce: any, expires: any) {
        this.token = token
        this.expires = expires
        this.nonce = nonce

        this.lineItems = []
        this.currency = null
        this.subtotal = null
        this.tax = null
        this.total = null

        this.store = null
        this.isInit = false
        this.loading = false
    }

    /**
     * Utility function to check if cart expiration timestamp is due.
     */
    static expired(timestamp: number, offset = CART_EXP_OFFSET) {
        return (new Date).getTime() / 1000 > (timestamp + offset)
    }

    /**
     * Create a new headless store cart with a prefilled cart key
     * (unique ID) and default expiration time.
     */
    static create() {
        let expires = (new Date).getTime() / 1000 + CART_EXP_OFFSET
        return new Cart(null, null, expires)
    }

    public setStore(store: any) {
        this.store = store
    }

    public async init() {
        // Return ready to use API, already initialized.
        if (this.isInit) return {
            api: this.store.storeApi
        }

        this.markLoading()
        const cart = await this.store.apiRequest({
            url: this.store.storeApi
                .cart()
                .toString()
        })
        // Save expiration to state
        this.store.storage.cartExp = this.expires
        // Now all the mandatory fetching is done, we can set isInit to true.
        this.isInit = true
        // Set other cart information.
        this.setCurrency(cart.totals.currency_code)
        this.setLineItems(cart.items)
        this.markNotLoading()
        // Return ready to use API.
        return {
            api: this.store.storeApi
        }
    }

    private setCurrency(currency: any) {
        this.currency = currency
    }

    public async add(lineItem: any) {
        const {api} = await this.init()
        this.markLoading()
        await this.store.apiRequest({
            url: api
                .cart()
                .addItem()
                .toString(),
            method: 'POST',
            data: lineItem
        })
        await this.refresh()
        this.markNotLoading()
    }

    public async clear() {
        const {api} = await this.init()
        this.markLoading()
        await this.store.apiRequest({
            url: api
                .cart()
                .items()
                .toString(),
            method: 'DELETE'
        })
        await this.refresh()
        this.markNotLoading()
    }

    public async refresh() {
        const {api} = await this.init()
        this.markLoading()
        let cart = await this.store.apiRequest({
            url: api
                .cart()
                .toString()
        })
        this.setLineItems(cart.items)
        this.markNotLoading()
    }

    private setLineItems(lineItems: any[]) {
        this.lineItems = []
        lineItems?.forEach((lineItem: any) => this.addLineItem(lineItem))
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
        )
        this.lineItems.push(lineItem)
        return lineItem
    }

    public async checkout(data: CheckoutData) {
        const {api} = await this.init()
        this.markLoading()
        let checkout = await this.store.apiRequest({
            url: api
                .checkout()
                .toString(),
            method: 'POST',
            data
        })
        this.setLineItems([])
        this.markNotLoading()
        return checkout.payment_result.redirect_url
    }

    public markLoading() {
        this.loading = true
    }

    public markNotLoading() {
        this.loading = false
    }

    public item(key: any) {
        let search = this.lineItems.filter(lineItems => lineItems.key === key)
        return search[0] ?? null
    }
}

export class CartLineItem {
    id: any
    key: any
    name: any
    images: any
    quantity: any
    currencySymbol: any
    price: any
    subtotal: any
    tax: any
    total: any
    private cart: Cart

    constructor(
        id: any,
        key: any,
        name: any,
        images: any,
        quantity: any,
        currency: any,
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
        this.currencySymbol = currencySymbol
        
        this.price = Dinero({amount: price, currency})
        this.subtotal = Dinero({amount: subtotal, currency})
        this.tax = Dinero({amount: tax, currency})
        this.total = Dinero({amount: total, currency})

        this.cart = cart
    }

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