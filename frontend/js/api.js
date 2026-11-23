/**
 * API Client for Telegram Mini App Store
 */
const API = {
    // Base URL - change to your server
    baseUrl: window.location.origin + '/api',

    /**
     * Make API request
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData.detail) {
                        if (typeof errorData.detail === 'string') {
                            errorMessage = errorData.detail;
                        } else if (errorData.detail.errors && Array.isArray(errorData.detail.errors)) {
                            // Format validation errors: "Product: Error; Product2: Error2"
                            errorMessage = errorData.detail.errors
                                .map(e => `${e.product_name}: ${e.error}`)
                                .join('; ');
                        } else if (errorData.detail.message) {
                            errorMessage = errorData.detail.message;
                        } else {
                            errorMessage = JSON.stringify(errorData.detail);
                        }
                    }
                } catch (e) { }
                throw new Error(errorMessage);
            }

            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    /**
     * Get all categories with subcategories
     */
    async getCategories(adminView = false) {
        const url = adminView ? '/categories?admin_view=true' : '/categories';
        return this.request(url);
    },

    /**
     * Get products with filters and pagination
     */
    async getProducts({
        category = null,
        subcategory = null,
        is_new = null,
        active = null,
        in_stock_zero = null,
        search = '',
        sort = 'newest',
        page = 1,
        limit = 12,
        admin_view = false
    } = {}) {
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (subcategory) params.append('subcategory', subcategory);
        if (is_new) params.append('is_new', 'true');
        if (active !== null) params.append('active', active.toString());
        if (in_stock_zero !== null) params.append('in_stock_zero', in_stock_zero.toString());
        if (search) params.append('q', search);
        if (admin_view) params.append('admin_view', 'true');
        params.append('sort', sort);
        params.append('page', page);
        params.append('limit', limit);

        return this.request(`/products?${params.toString()}`);
    },

    /**
     * Get single product
     */
    async getProduct(id, admin_view = false) {
        const url = `/products/${id}` + (admin_view ? '?admin_view=true' : '');
        return this.request(url);
    },

    /**
     * Validate cart before checkout
     */
    async validateCart(items) {
        return this.request('/cart/validate', {
            method: 'POST',
            body: JSON.stringify({ items })
        });
    },

    /**
     * Create order
     */
    async createOrder(orderData) {
        return this.request('/orders', {
            method: 'POST',
            headers: {
                'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || '',
                'X-WhatsApp-Token': (typeof App !== 'undefined' ? App.user?.token : '') || ''
            },
            body: JSON.stringify(orderData)
        });
    },

    /**
     * Get user orders
     */
    async getOrders(telegramId = null, whatsappPhone = null, token = null) {
        const searchParams = new URLSearchParams();
        if (typeof telegramId === 'object' && telegramId !== null) {
            if (telegramId.telegramId) searchParams.append('telegram_user_id', telegramId.telegramId);
            if (telegramId.whatsappPhone) searchParams.append('whatsapp_phone', telegramId.whatsappPhone);
            if (telegramId.token) searchParams.append('token', telegramId.token);
        } else {
            if (telegramId) searchParams.append('telegram_user_id', telegramId);
            if (whatsappPhone) searchParams.append('whatsapp_phone', whatsappPhone);
            if (token) searchParams.append('token', token);
        }
        const params = searchParams.toString() ? `?${searchParams.toString()}` : '';
        return this.request(`/orders/me${params}`, {headers: {'X-Telegram-Init-Data': window.Telegram?.WebApp?.initData || ''}});
    },



    /**
     * Register Web Push subscription
     */
    async registerPushSubscription(subscription, phone) {
        const subData = subscription.toJSON();
        return this.request('/auth/push/register', {
            method: 'POST',
            body: JSON.stringify({
                phone: phone,
                endpoint: subData.endpoint,
                keys: {
                    p256dh: subData.keys.p256dh,
                    auth: subData.keys.auth
                }
            })
        });
    },

    /**
     * Get image URL from file_id
     */
    getImageUrl(fileIdOrUrl, size = 'medium') {
        if (!fileIdOrUrl) return 'assets/placeholder.svg';

        // If it's already a URL
        if (fileIdOrUrl.startsWith('http')) {
            return fileIdOrUrl;
        }

        // If it's a file path
        if (fileIdOrUrl.startsWith('assets/')) {
            return fileIdOrUrl;
        }

        // If it's a static backend file (uploaded)
        if (fileIdOrUrl.startsWith('/static/')) {
            const origin = new URL(this.baseUrl).origin;
            const fullUrl = `${origin}${fileIdOrUrl}`;
            console.log('[API] Resolved static URL:', fullUrl);
            return fullUrl;
        }

        if (fileIdOrUrl.startsWith('/')) {
            return fileIdOrUrl;
        }

        // Telegram file_id - get via API proxy
        return `${this.baseUrl}/images/${fileIdOrUrl}?size=${size}`;
    }
};

// Make it globally available
window.API = API;
