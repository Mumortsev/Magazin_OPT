/**
 * Main App Module - Navigation, Auth, Checkout, Modal
 */
const App = {
    // State
    currentView: 'productsView',
    user: null,
    isAuthorized: false,
    ordersData: [],

    /**
     * Initialize app
     */
    async init() {
        try {
            // Setup event listeners immediately
            this.setupEventListeners();

            // Initialize cart
            Cart.init();

            // Telegram WebApp
            this.initTelegramWebApp();

            // Initialize modules with error handling
            try {
                await Catalog.init();
                // Рендер стартовой страницы категорий
                Catalog.renderCategoriesGrid();
            } catch (err) {
                console.error('Catalog init failed:', err);
                App.showToast('Ошибка загрузки каталога');
            }

            // Update cart badges
            this.updateCartBadge();

            // Check for existing session
            this.checkAuth();
        } catch (error) {
            console.error('App init failed:', error);
        }
    },

    /**
     * Initialize Telegram WebApp
     */
    initTelegramWebApp() {
        if (window.Telegram && Telegram.WebApp) {
            const tg = Telegram.WebApp;

            // Expand to full height
            tg.expand();

            // Set theme colors
            document.documentElement.style.setProperty('--tg-bg-color', tg.backgroundColor || '#F5F0E8');
            document.documentElement.style.setProperty('--tg-text-color', tg.textColor || '#1a1a2e');

            // Get user from Telegram
            if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
                this.user = tg.initDataUnsafe.user;
                this.isAuthorized = true;
                this.updateProfileUI();
            }

            // Enable closing confirmation
            tg.enableClosingConfirmation();

            // Back button handler
            tg.BackButton.onClick(() => this.goBack());
        }
    },

    /**
     * Update welcome message with user name
     */
    updateWelcomeMessage() {
        const welcomeEl = document.getElementById('welcomeMessage');
        if (!welcomeEl) return;

        if (this.user && this.user.first_name) {
            welcomeEl.textContent = `Добро пожаловать, ${this.user.first_name}!`;
        } else {
            welcomeEl.textContent = 'Добро пожаловать!';
        }
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Back buttons
        const productBackBtn = document.getElementById('productBackBtn');
        if (productBackBtn) productBackBtn.addEventListener('click', () => this.showCatalog());

        const cartBackBtn = document.getElementById('cartBackBtn');
        if (cartBackBtn) cartBackBtn.addEventListener('click', () => this.showCatalog());

        const checkoutBackBtn = document.getElementById('checkoutBackBtn');
        if (checkoutBackBtn) checkoutBackBtn.addEventListener('click', () => this.showCart());

        const profileBackBtn = document.getElementById('profileBackBtn');
        if (profileBackBtn) profileBackBtn.addEventListener('click', () => this.showCatalog());

        // Header Catalog Button
        const headerCatalogBtn = document.getElementById('headerCatalogBtn');
        if (headerCatalogBtn) {
            headerCatalogBtn.addEventListener('click', () => Catalog.openMenu());
        }

        // Checkout button
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                this.showView('checkoutView');
                this.renderCheckoutSummary();
            });
        }

        // Customer type change
        const customerType = document.getElementById('customerType');
        if (customerType) {
            customerType.addEventListener('change', (e) => {
                const orgGroup = document.getElementById('orgNameGroup');
                const orgInput = document.getElementById('customerOrg');
                if (!orgGroup || !orgInput) return;

                if (e.target.value === 'company' || e.target.value === 'sole_proprietor') {
                    orgGroup.style.display = 'block';
                    orgInput.required = true;
                } else {
                    orgGroup.style.display = 'none';
                    orgInput.required = false;
                    orgInput.value = '';
                }
            });
        }

        // Checkout form
        const checkoutForm = document.getElementById('checkoutForm');
        if (checkoutForm) {
            checkoutForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitOrder();
            });
        }

        // Telegram auth button
        const telegramAuthBtn = document.getElementById('telegramAuthBtn');
        if (telegramAuthBtn) {
            telegramAuthBtn.addEventListener('click', () => {
                this.telegramAuth();
            });
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.logout();
            });
        }

        // Bottom navigation
        this.setupBottomNav();

        // Product modal
        this.setupModal();

        // Order modal
        this.setupOrderModal();

        // Phone mask
        this.setupPhoneMask();
    },

    /**
     * Setup phone mask
     */
    setupPhoneMask() {
        const input = document.getElementById('customerPhone');
        if (!input) return;

        const formatPhone = (value) => {
            if (!value) return '';

            // Strip non-digits
            let digits = value.replace(/\D/g, '');

            // Handle starting with 8 or other digit by forcing 7
            if (digits.length > 0) {
                if (digits[0] === '8') {
                    digits = '7' + digits.substring(1);
                } else if (digits[0] !== '7') {
                    digits = '7' + digits;
                }
            }

            // Limit to 11 digits (7 + 10 digits)
            digits = digits.substring(0, 11);

            let formatted = '';
            if (digits.length > 0) formatted += '+7';
            if (digits.length > 1) formatted += ' (' + digits.substring(1, 4);
            if (digits.length > 4) formatted += ') ' + digits.substring(4, 7);
            if (digits.length > 7) formatted += '-' + digits.substring(7, 9);
            if (digits.length > 9) formatted += '-' + digits.substring(9, 11);

            return formatted;
        };

        input.addEventListener('input', (e) => {
            const oldValue = e.target.value;
            const newValue = formatPhone(oldValue);

            if (oldValue !== newValue) {
                e.target.value = newValue;
            }
        });

        // Prevent deleting prefix easily
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && input.value.length <= 4) {
                e.preventDefault();
                input.value = '';
            }
        });

        // Focus handler
        input.addEventListener('focus', () => {
            if (!input.value) {
                input.value = '+7 (';
            }
        });

        // Blur handler
        input.addEventListener('blur', () => {
            if (input.value === '+7' || input.value === '+7 (') {
                input.value = '';
            }
        });
    },

    /**
     * Setup bottom navigation
     */
    setupBottomNav() {
        // Use event delegation on the container
        const navContainer = document.querySelector('.nav-pill');

        if (!navContainer) return;

        navContainer.addEventListener('click', (e) => {
            // Find the closest nav-item ancestor (or the element itself)
            const item = e.target.closest('.nav-item');

            // If no nav-item was clicked, or it doesn't have a view (e.g. just a container), ignore
            if (!item || !item.dataset.view) return;

            const viewId = item.dataset.view;

            // Update active state
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Show view
            if (viewId === 'cartView') {
                this.showCart();
            } else if (viewId === 'profileView') {
                this.showView('profileView');
            } else if (viewId === 'homeView') {
                this.showHome();
            } else {
                this.showCatalog();
            } else {
                this.showView('productsView');
            }
        });
    },

    /**
     * Setup product modal
     */
    setupModal() {
        const modal = document.getElementById('productModal');
        const backdrop = document.getElementById('modalBackdrop');
        const closeBtn = document.getElementById('modalCloseBtn');
        const cartBtn = document.getElementById('modalCartBtn');

        // Backdrop click disabled - modal closes only via close button or add to cart
        // backdrop.addEventListener('click', () => this.closeModal());

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }

        // Cart button in modal
        if (cartBtn) {
            cartBtn.addEventListener('click', () => {
                this.closeModal();
                this.showCart();
            });
        }

        // Swipe down to close disabled - modal closes only via close button or add to cart
    },

    /**
     * Open product modal
     */
    openModal(productId) {
        const modal = document.getElementById('productModal');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Load product details
        Catalog.showProductInModal(productId);

        // Update modal cart badge
        this.updateModalCartBadge();
    },

    /**
     * Close product modal
     */
    closeModal() {
        const modal = document.getElementById('productModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
    },

    /**
     * Update modal cart badge
     */
    updateModalCartBadge() {
        const badge = document.getElementById('modalCartBadge');
        const count = Cart.getItemsCount();

        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    },

    /**
     * Check for saved session
     */
    checkAuth() {
        const savedUser = localStorage.getItem('shop_user');
        if (savedUser) {
            try {
                this.user = JSON.parse(savedUser);
                this.isAuthorized = true;
                this.updateProfileUI();
                this.updateWelcomeMessage();
            } catch (e) {
                localStorage.removeItem('shop_user');
            }
        }
    },

    /**
     * Telegram auth
     */
    telegramAuth() {
        if (window.Telegram && Telegram.WebApp) {
            const tg = Telegram.WebApp;

            if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
                this.user = tg.initDataUnsafe.user;
                this.isAuthorized = true;
                localStorage.setItem('shop_user', JSON.stringify(this.user));
                this.updateProfileUI();
                this.updateWelcomeMessage();
                this.showToast('Вы авторизованы!');
            } else {
                this.showToast('Откройте приложение через Telegram');
            }
        } else {
            // Demo mode
            this.user = {
                id: 12345678,
                first_name: 'Гость',
                username: 'demo_user'
            };
            this.isAuthorized = true;
            localStorage.setItem('shop_user', JSON.stringify(this.user));
            this.updateProfileUI();
            this.updateWelcomeMessage();
            this.showToast('Демо авторизация');
        }
    },

    /**
     * Logout
     */
    logout() {
        this.user = null;
        this.isAuthorized = false;
        localStorage.removeItem('shop_user');
        this.updateProfileUI();
        this.updateWelcomeMessage();
        this.showToast('Вы вышли из аккаунта');
    },

    /**
     * Update profile UI
     */
    updateProfileUI() {
        const authSection = document.getElementById('profileAuth');
        const infoSection = document.getElementById('profileInfo');

        if (this.isAuthorized && this.user) {
            authSection.style.display = 'none';
            infoSection.style.display = 'block';

            document.getElementById('profileName').textContent =
                this.user.first_name + (this.user.last_name ? ' ' + this.user.last_name : '');
            document.getElementById('profileId').textContent = 'ID: ' + this.user.id;

            this.loadOrders();
        } else {
            authSection.style.display = 'block';
            infoSection.style.display = 'none';
        }
    },

    /**
     * Load user orders
     */
    async loadOrders() {
        if (!this.user) {
            document.getElementById('ordersEmpty').style.display = 'block';
            document.getElementById('ordersList').innerHTML = '';
            return;
        }

        try {
            const orders = await API.getOrders(this.user.id);

            // Handle wrapped response {orders: []} or array []
            const ordersList = orders.orders ? orders.orders : orders;

            if (!ordersList || !Array.isArray(ordersList) || ordersList.length === 0) {
                document.getElementById('ordersEmpty').style.display = 'block';
                document.getElementById('ordersList').innerHTML = '';
                return;
            }

            // Store orders for later use
            this.ordersData = ordersList;

            document.getElementById('ordersEmpty').style.display = 'none';

            const html = ordersList.map(order => {
                const itemsHtml = order.items.map(item => `
                    <div class="order-item-row">
                        <span>${item.product_name} ${item.product_sku ? `<br><small>Арт: ${item.product_sku}</small>` : ''}</span>
                        <span>${item.quantity_packs} шт (${Math.round(item.quantity_pieces / item.quantity_packs)} шт./уп.) × ${item.price_per_unit}₽</span>
                        <span>${item.subtotal}₽</span>
                    </div>
                `).join('');

                return `
                <div class="order-card" data-order-id="${order.id}">
                    <div class="order-header">
                        <span class="order-id">Заказ #${order.id}</span>
                        <span class="order-status ${order.status}">${this.getStatusLabel(order.status)}</span>
                    </div>
                    <div class="order-items-list">
                        ${itemsHtml}
                    </div>
                    <div class="order-footer">
                        <span class="order-total-label">Итого:</span>
                        <span class="order-total">${order.total_amount || order.total}₽</span>
                    </div>
                     <div class="order-date-row">
                        <span class="order-date">${this.formatDate(order.created_at)}</span>
                    </div>
                </div>
            `}).join('');

            document.getElementById('ordersList').innerHTML = html;

            // Add click handlers to order cards
            document.querySelectorAll('.order-card').forEach(card => {
                card.addEventListener('click', () => {
                    const orderId = parseInt(card.dataset.orderId);
                    const order = this.ordersData.find(o => o.id === orderId);
                    if (order) {
                        this.openOrderModal(order);
                    }
                });
            });
        } catch (error) {
            console.error('Failed to load orders:', error);
            document.getElementById('ordersEmpty').style.display = 'block';
        }
    },

    /**
     * Get status label
     */
    getStatusLabel(status) {
        const labels = {
            'new': 'Новый',
            'processing': 'В работе',
            'shipped': 'Отправлен',
            'completed': 'Выполнен',
            'cancelled': 'Отменён',
            'accepted': 'Принят',
            'rejected': 'Отклонён'
        };
        return labels[status] || status;
    },

    /**
     * Format date
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    },

    /**
     * Show view
     */
    showView(viewId) {
        // Hide all views
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));

        // Show target view
        const view = document.getElementById(viewId);
        if (view) {
            view.classList.remove('hidden');
            this.currentView = viewId;
        }

        // Toggle header visibility
        const header = document.querySelector('.header');
        const mainContent = document.getElementById('mainContent');
        const hideHeaderViews = ['checkoutView', 'cartView', 'profileView', 'categoriesView'];

        if (hideHeaderViews.includes(viewId)) {
            header.style.display = 'none';
            mainContent.classList.add('no-header');
        } else {
            header.style.display = 'block';
            mainContent.classList.remove('no-header');
        }

        // Update back button
        this.updateBackButton();

        // Update nav active state
        this.updateNavActiveState(viewId);
    },

    /**
     * Update nav active state
     */
    updateNavActiveState(viewId) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        if (viewId === 'homeView') {
            const navHome = document.getElementById('navHome');
            if (navHome) navHome.classList.add('active');
        } else if (viewId === 'productsView') {
            // Products view might not have its own bottom nav button, but if needed we handle it here
        } else if (viewId === 'cartView') {
            document.getElementById('navCart').classList.add('active');
        } else if (viewId === 'profileView') {
            document.getElementById('navProfile').classList.add('active');
        }
    },

    /**
     * Обновить кнопку «назад» в Telegram Web App
     * Скрываем на домашних экранах (категории, каталог)
     */
    updateBackButton() {
        if (window.Telegram && Telegram.WebApp) {
            const homeViews = ['categoriesView', 'productsView'];
            if (!homeViews.includes(this.currentView)) {
                Telegram.WebApp.BackButton.show();
            } else {
                Telegram.WebApp.BackButton.hide();
            }
        }
    },

    /**
     * Go back
     */
    goBack() {
        switch (this.currentView) {
            case 'productsView':
                this.showHome();
                break;
            case 'productView':
            case 'profileView':
            case 'cartView':
                this.showHome();
                break;
            case 'checkoutView':
                this.showCart();
                break;
            default:
                this.showHome();
        }
    },

    /**
     * Show Home View
     */
    showHome() {
        this.showView('homeView');
    },

    /**
     * Show catalog
     */
    showCatalog() {
        this.showView('categoriesView');
        Catalog.renderCategoriesGrid();
    },

    /**
     * Показать товары (по категории)
     */
    showProducts() {
        this.showView('productsView');
    },

    /**
     * Show cart
     */
    showCart() {
        this.showView('cartView');
        this.renderCart();
    },

    /**
     * Render cart
     */
    renderCart() {
        const items = Cart.items;
        const container = document.getElementById('cartItems');
        const emptyMsg = document.getElementById('cartEmpty');
        const footer = document.getElementById('cartFooter');

        if (items.length === 0) {
            container.innerHTML = '';
            emptyMsg.style.display = 'block';
            footer.style.display = 'none';
            return;
        }

        emptyMsg.style.display = 'none';
        footer.style.display = 'block';

        const html = items.map(item => {
            const pieces = item.packs * (item.product.pieces_per_pack || 1);
            const subtotal = pieces * item.product.price_per_unit;

            return `
            <div class="cart-item" data-id="${item.product.id}">
                <img class="cart-item-image"
                     src="${API.getImageUrl(item.product.images?.[0]?.file_id || item.product.images?.[0]?.image_url || item.product.image_file_id || item.product.image_url, 'small')}"
                     alt="${item.product.name}"
                     loading="lazy"
                     onerror="this.src='assets/placeholder.svg'">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.product.name}</div>
                    <div class="cart-item-details">${pieces} шт (${item.packs} уп. × ${item.product.pieces_per_pack || 1} шт.) × ${item.product.price_per_unit}₽</div>
                    <div class="cart-item-controls">
                        <button class="cart-qty-btn" data-action="decrease" ${item.packs <= 1 ? 'disabled' : ''}>−</button>
                        <span class="cart-item-qty">${pieces}</span>
                        <button class="cart-qty-btn" data-action="increase">+</button>
                        <span class="cart-item-price">${subtotal.toFixed(2)}₽</span>
                        <button class="cart-item-remove" data-action="remove">🗑</button>
                    </div>
                </div>
            </div>
        `}).join('');

        container.innerHTML = html;

        // Update total
        document.getElementById('cartTotal').textContent = Cart.getTotal().toFixed(2) + '₽';

        // Add handlers
        container.querySelectorAll('.cart-item').forEach(el => {
            const productId = parseInt(el.dataset.id);

            el.querySelector('[data-action="decrease"]').addEventListener('click', () => {
                const item = Cart.items.find(i => i.product.id === productId);
                if (item && item.packs > 1) {
                    Cart.updateQuantity(productId, item.packs - 1);
                    this.renderCart();
                    this.updateCartBadge();
                }
            });

            el.querySelector('[data-action="increase"]').addEventListener('click', () => {
                const item = Cart.items.find(i => i.product.id === productId);
                if (item) {
                    Cart.updateQuantity(productId, item.packs + 1);
                    this.renderCart();
                    this.updateCartBadge();
                }
            });

            el.querySelector('[data-action="remove"]').addEventListener('click', () => {
                Cart.removeItem(productId);
                this.renderCart();
                this.updateCartBadge();
                this.showToast('Товар удалён');
            });
        });
    },

    /**
     * Render checkout summary
     */
    renderCheckoutSummary() {
        const items = Cart.items;
        const container = document.getElementById('checkoutSummary');

        let html = items.map(item => {
            const pieces = item.packs * (item.product.pieces_per_pack || 1);
            const subtotal = pieces * item.product.price_per_unit;

            return `
            <div class="checkout-summary-item">
                <span>${item.product.name} <br> ${item.packs} шт (${item.product.pieces_per_pack || 1} шт./уп.) × ${item.product.price_per_unit}₽</span>
                <span>${subtotal.toFixed(2)}₽</span>
            </div>
        `}).join('');

        html += `
            <div class="checkout-summary-total">
                <span>Итого:</span>
                <span>${Cart.getTotal().toFixed(2)}₽</span>
            </div>
        `;

        container.innerHTML = html;
    },

    /**
     * Submit order
     */
    async submitOrder() {
        const items = Cart.items;
        if (items.length === 0) {
            this.showToast('Корзина пуста');
            return;
        }

        const name = document.getElementById('customerName').value.trim();
        const phone = document.getElementById('customerPhone').value.trim();
        const comment = document.getElementById('customerComment').value.trim();

        if (!name) {
            this.showToast('Введите ФИО');
            return;
        }
        if (!phone) {
            this.showToast('Введите телефон');
            return;
        }

        const orderData = {
            telegram_user_id: this.user?.id || 0,
            customer_name: name,
            customer_phone: phone,
            items: items.map(item => ({
                product_id: item.product.id,
                quantity_packs: item.packs
            }))
        };

        try {
            await API.createOrder(orderData);
            Cart.clear();
            this.updateCartBadge();
            this.showToast('Заказ оформлен!');
            this.showCatalog();

            if (this.isAuthorized) {
                setTimeout(() => {
                    this.showView('profileView');
                    this.loadOrders();
                }, 1000);
            }

        } catch (error) {
            console.error('Order failed:', error);
            this.showToast('Ошибка: ' + error.message);
        }
    },

    /**
     * Update all cart badges
     */
    updateCartBadge() {
        const count = Cart.getItemsCount();

        // Header badge
        const headerBadge = document.getElementById('cartBadge');
        if (headerBadge) {
            if (count > 0) {
                headerBadge.textContent = count;
                headerBadge.style.display = 'flex';
            } else {
                headerBadge.style.display = 'none';
            }
        }

        // Nav badge
        const navBadge = document.getElementById('navCartBadge');
        if (navBadge) {
            if (count > 0) {
                navBadge.textContent = count;
                navBadge.style.display = 'flex';
            } else {
                navBadge.style.display = 'none';
            }
        }

        // Modal badge
        this.updateModalCartBadge();
    },

    /**
     * Setup order modal
     */
    setupOrderModal() {
        const closeBtn = document.getElementById('orderModalCloseBtn');

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeOrderModal());
        }

        // Backdrop click disabled - modal closes only via close button
    },

    /**
     * Open order modal
     */
    openOrderModal(order) {
        const modal = document.getElementById('orderModal');
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Render order details
        this.showOrderInModal(order);
    },

    /**
     * Close order modal
     */
    closeOrderModal() {
        const modal = document.getElementById('orderModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
    },

    /**
     * Show order details in modal
     */
    showOrderInModal(order) {
        const container = document.getElementById('orderDetailContent');

        // Format date and time
        const orderDateTime = this.formatDateTime(order.created_at);

        // Build items HTML with images
        const itemsHtml = order.items.map(item => {
            const imageUrl = item.product_image
                ? API.getImageUrl(item.product_image, 'small')
                : 'assets/placeholder.svg';

            const skuHtml = item.product_sku
                ? `<div class="order-detail-item-sku">Артикул: ${item.product_sku}</div>`
                : '';

            // Calculate pieces per pack if not directly available, assuming quantity_pieces is total pieces
            const piecesPerPack = item.quantity_packs > 0 ? Math.round(item.quantity_pieces / item.quantity_packs) : 1;

            return `
                <div class="order-detail-item">
                    <img class="order-detail-item-image"
                         src="${imageUrl}"
                         alt="${item.product_name}"
                         onerror="this.src='assets/placeholder.svg'">
                    <div class="order-detail-item-info">
                        <div class="order-detail-item-name">${item.product_name}</div>
                        ${skuHtml}
                        <div class="order-detail-item-qty">${item.quantity_packs} шт (${piecesPerPack} шт./уп.) × ${item.price_per_unit}₽</div>
                        <div class="order-detail-item-price">${item.subtotal}₽</div>
                    </div>
                </div>
            `;
        }).join('');

        // Get status class for styling
        const statusClass = order.status || 'new';

        container.innerHTML = `
            <div class="order-detail-header">
                <span class="order-detail-id">Заказ #${order.id}</span>
                <span class="order-detail-status order-status ${statusClass}">${this.getStatusLabel(order.status)}</span>
            </div>

            <div class="order-detail-info">
                <div class="order-detail-info-row">
                    <span class="order-detail-info-label">Дата и время:</span>
                    <span class="order-detail-info-value">${orderDateTime}</span>
                </div>
            </div>

            <div class="order-detail-items-title">Товары в заказе</div>
            <div class="order-detail-items">
                ${itemsHtml}
            </div>

            <div class="order-detail-total">
                <span class="order-detail-total-label">Итого</span>
                <span class="order-detail-total-amount">${order.total_amount || order.total}₽</span>
            </div>
        `;
    },

    /**
     * Format date and time
     */
    formatDateTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Show toast message
     */
    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 2500);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Make it global
window.App = App;
