/**
 * Cart management module
 */
const Cart = {
    items: [],
    storageKey: 'shop_cart',

    /**
     * Initialize cart from localStorage
     */
    init() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                this.items = JSON.parse(saved);
            }
        } catch (e) {
            console.error('Failed to load cart:', e);
            this.items = [];
        }
        this.updateBadge();
    },

    /**
     * Save cart to localStorage
     */
    save() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.items));
        } catch (e) {
            console.error('Failed to save cart:', e);
        }
        this.updateBadge();
    },

    /**
     * Add product to cart
     */
    addProduct(product, packs = 1) {
        const existingIndex = this.items.findIndex(item => item.product.id === product.id);

        if (existingIndex >= 0) {
            this.items[existingIndex].packs += packs;
        } else {
            this.items.push({
                product: product,
                packs: packs
            });
        }

        this.save();
        App.showToast(`✅ ${product.name} добавлен в корзину`);
    },

    /**
     * Update item quantity
     */
    updateQuantity(productId, packs) {
        const item = this.items.find(item => item.product.id === productId);
        if (item) {
            item.packs = Math.max(1, packs);
            this.save();
        }
    },

    /**
     * Remove item from cart
     */
    removeItem(productId) {
        if (!confirm('Вы уверены, что хотите удалить этот товар из корзины?')) return;

        this.items = this.items.filter(item => item.product.id !== productId);
        this.save();

        // Revert UI state on product card if Catalog exists
        if (typeof Catalog !== 'undefined' && Catalog.updateCardCartState) {
            Catalog.updateCardCartState(productId);
        }
    },

    /**
     * Clear cart
     */
    clear() {
        this.items = [];
        this.save();
    },

    /**
     * Get cart items for API
     */
    getApiItems() {
        return this.items.map(item => ({
            product_id: item.product.id,
            quantity_packs: item.packs
        }));
    },

    /**
     * Calculate total
     */
    getTotal() {
        return this.items.reduce((sum, item) => {
            const pieces = item.packs * (item.product.pieces_per_pack || 1);
            return sum + (pieces * item.product.price_per_unit);
        }, 0);
    },

    /**
     * Get total items count
     */
    getItemsCount() {
        return this.items.reduce((sum, item) => sum + item.packs, 0);
    },

    /**
     * Update cart badge
     */
    updateBadge() {
        const badge = document.getElementById('cartBadge');
        const count = this.getItemsCount();

        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    },

};

// Export
window.Cart = Cart;
