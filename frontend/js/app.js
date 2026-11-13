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
            // Handle In-App browser redirects/guides first
            if (this.handleInAppBrowser()) {
                return;
            }

            // Register Service Worker (skipped inside APK wrappers to prevent WebView hangs)
            const isWrapper = navigator.userAgent.includes('KurortnikWrapper') || window.location.search.includes('wrapper=true');
            if ('serviceWorker' in navigator && !isWrapper) {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => {
                        console.log('Service Worker registered with scope:', reg.scope);
                        this.swRegistration = reg;
                        
                        // Force update check on load
                        reg.update();

                        // Check for updates
                        reg.addEventListener('updatefound', () => {
                            const newWorker = reg.installing;
                            if (newWorker) {
                                newWorker.addEventListener('statechange', () => {
                                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                        console.log('New Service Worker installed. Activating...');
                                    }
                                });
                            }
                        });
                    })
                    .catch(err => console.error('Service Worker registration failed:', err));

                // Watch for controllerchange (when the new service worker takes control)
                let refreshing = false;
                const hasController = !!navigator.serviceWorker.controller;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (hasController && !refreshing) {
                        refreshing = true;
                        console.log('Service Worker updated. Reloading page...');
                        window.location.reload();
                    }
                });
            }

            // Listen for Android install prompt
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredPrompt = e;
                this.showAndroidInstallPrompt();
            });

            // Parse WhatsApp URL parameters
            const urlParams = new URLSearchParams(window.location.search);
            const platform = urlParams.get('platform');
            const phone = urlParams.get('phone');
            const token = urlParams.get('token');

            if (platform === 'whatsapp' && phone && token) {
                this.user = {
                    id: 0,
                    first_name: 'Покупатель',
                    whatsapp_phone: phone,
                    token: token,
                    platform: 'whatsapp'
                };
                this.isAuthorized = true;
                localStorage.setItem('shop_user', JSON.stringify(this.user));
                
                const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.history.replaceState({ path: newUrl }, '', newUrl);
            }

            // Check privacy consent first before loading anything
            await this.checkPrivacyConsent();

            // Check for existing session
            this.checkAuth();

            // Check iOS Safari install banner
            this.checkPWAInstallPrompt();

            // Initialize backup PWA install button in Profile tab
            this.initProfileInstallButton();

            // Set up browser history management
            this.setupHistory();

            // Setup event listeners immediately
            this.setupEventListeners();

            // Initialize cart
            Cart.init();

            // Telegram WebApp
            this.initTelegramWebApp();

            // Initialize modules with error handling
            try {
                await Catalog.init();
            } catch (err) {
                console.error('Catalog init failed:', err);
                App.showToast('Ошибка загрузки каталога');
            }

            // Update cart badges
            this.updateCartBadge();

            // Start desktop notifications polling if platform=desktop
            if (urlParams.get('platform') === 'desktop' || window.pywebview) {
                this.startDesktopPolling();
            }
        } catch (error) {
            console.error('App init failed:', error);
        }
    },

    startDesktopPolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(() => {
            if (this.user) {
                this.loadOrders();
            }
        }, 15000); // Poll every 15 seconds
    },

    showDesktopNotification(title, message) {
        if (window.pywebview && window.pywebview.api && window.pywebview.api.show_notification) {
            window.pywebview.api.show_notification(title, message);
        } else if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body: message });
        }
    },

    /**
     * Check and handle user privacy consent on startup
     */
    checkPrivacyConsent() {
        return new Promise((resolve) => {
            const consent = localStorage.getItem('user_privacy_consent');
            if (consent === 'true') {
                resolve();
                return;
            }

            const modal = document.getElementById('privacyConsentModal');
            const checkbox = document.getElementById('privacyCheckbox');
            const acceptBtn = document.getElementById('privacyAcceptBtn');
            const declineBtn = document.getElementById('privacyDeclineBtn');

            if (!modal) {
                resolve();
                return;
            }

            // Show modal and freeze body scroll
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Listen to checkbox change
            checkbox.addEventListener('change', (e) => {
                acceptBtn.disabled = !e.target.checked;
            });

            // Show privacy policy text modal when clicking the link
            const textLink = document.getElementById('privacyTextLink');
            const textModal = document.getElementById('privacyTextModal');
            const textCloseBtn = document.getElementById('privacyTextCloseBtn');

            if (textLink && textModal && textCloseBtn) {
                textLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    textModal.classList.remove('hidden');
                });

                textCloseBtn.addEventListener('click', () => {
                    textModal.classList.add('hidden');
                });
            }

            // Agree handler
            acceptBtn.addEventListener('click', () => {
                localStorage.setItem('user_privacy_consent', 'true');
                modal.classList.add('hidden');
                document.body.style.overflow = '';
                resolve();
            });

            // Decline handler
            declineBtn.addEventListener('click', () => {
                if (window.Telegram && Telegram.WebApp) {
                    Telegram.WebApp.close();
                } else {
                    alert('Для использования платформы необходимо принять Политику конфиденциальности.');
                }
            });
        });
    },

    /**
     * Initialize Telegram WebApp
     */
    initTelegramWebApp() {
        if (window.Telegram && Telegram.WebApp) {
            const tg = Telegram.WebApp;

            // Expand to full height
            tg.expand();

            // Disable vertical swipes to prevent WebApp from closing on swipe down
            if (typeof tg.disableVerticalSwipes === 'function') {
                tg.disableVerticalSwipes();
            }

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
        if (productBackBtn) productBackBtn.addEventListener('click', () => this.showCategories());

        const cartBackBtn = document.getElementById('cartBackBtn');
        if (cartBackBtn) cartBackBtn.addEventListener('click', () => this.showCategories());

        const checkoutBackBtn = document.getElementById('checkoutBackBtn');
        if (checkoutBackBtn) checkoutBackBtn.addEventListener('click', () => this.showCart());

        const profileBackBtn = document.getElementById('profileBackBtn');
        if (profileBackBtn) profileBackBtn.addEventListener('click', () => this.showCategories());

        const productsBackBtn = document.getElementById('productsBackBtn');
        if (productsBackBtn) productsBackBtn.addEventListener('click', () => this.showCategories());

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



        // Checkout form
        const checkoutForm = document.getElementById('checkoutForm');
        if (checkoutForm) {
            checkoutForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitOrder();
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
            } else if (viewId === 'categoriesView') {
                this.showCategories();
            } else {
                this.showCatalog();
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
        const infoSection = document.getElementById('profileInfo');
        if (!infoSection) return;

        infoSection.style.display = 'block';

        const logoutBtn = document.getElementById('logoutBtn');
        const profileId = document.getElementById('profileId');
        const avatarEl = document.getElementById('profileAvatar');

        if (this.isAuthorized && this.user) {
            document.getElementById('profileName').textContent =
                this.user.first_name + (this.user.last_name ? ' ' + this.user.last_name : '');
            
            if (this.user.platform === 'whatsapp') {
                if (profileId) {
                    profileId.textContent = 'WhatsApp: +' + this.user.whatsapp_phone;
                    profileId.style.display = 'block';
                }
                if (logoutBtn) logoutBtn.style.display = 'block';
            } else {
                if (profileId) {
                    profileId.textContent = 'ID: ' + this.user.id;
                    profileId.style.display = 'block';
                }
                if (logoutBtn) logoutBtn.style.display = 'none'; // Telegram users don't need logout button
            }

            // Update Avatar (Telegram/WhatsApp if any)
            if (avatarEl) {
                let avatarUrl = this.user.photo_url || '';
                if (avatarUrl) {
                    avatarEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    avatarEl.style.background = 'transparent';
                } else {
                    avatarEl.textContent = '👤';
                    avatarEl.style.background = '';
                }
            }
        } else {
            // Guest mode
            document.getElementById('profileName').textContent = 'Гость';
            if (profileId) {
                profileId.textContent = 'Гостевой сеанс';
                profileId.style.display = 'block';
            }
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (avatarEl) {
                avatarEl.textContent = '👤';
                avatarEl.style.background = '';
            }
        }

        this.loadOrders();
    },

    /**
     * Load user orders
     */
    async loadOrders() {
        if (!this.user) {
            // Check if there are local guest orders
            const localOrders = localStorage.getItem('guest_orders');
            if (localOrders) {
                try {
                    const parsedOrders = JSON.parse(localOrders);
                    if (parsedOrders && Array.isArray(parsedOrders) && parsedOrders.length > 0) {
                        this.ordersData = parsedOrders;
                        document.getElementById('ordersEmpty').style.display = 'none';

                        const html = parsedOrders.map(order => {
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
                        return;
                    }
                } catch (e) {
                    console.error('Error parsing local guest orders:', e);
                }
            }

            document.getElementById('ordersEmpty').style.display = 'block';
            document.getElementById('ordersList').innerHTML = '';
            return;
        }

        try {
            let orders;
            if (this.user.platform === 'whatsapp') {
                orders = await API.getOrders(null, this.user.whatsapp_phone, this.user.token);
            } else {
                orders = await API.getOrders(this.user.id);
            }

            // Handle wrapped response {orders: []} or array []
            const ordersList = orders.orders ? orders.orders : orders;

            if (!ordersList || !Array.isArray(ordersList) || ordersList.length === 0) {
                document.getElementById('ordersEmpty').style.display = 'block';
                document.getElementById('ordersList').innerHTML = '';
                return;
            }

            // Compare statuses to trigger native notification
            const oldOrders = this.ordersData || [];
            if (oldOrders.length > 0 && ordersList.length > 0) {
                ordersList.forEach(newOrder => {
                    const oldOrder = oldOrders.find(o => o.id === newOrder.id);
                    if (oldOrder && oldOrder.status !== newOrder.status) {
                        const statusLabel = this.getStatusLabel(newOrder.status);
                        this.showDesktopNotification(
                            "Статус заказа изменен",
                            `Статус вашего заказа #${newOrder.id} изменен на: ${statusLabel}`
                        );
                    }
                });
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
     * Hide all views
     */
    hideAllViews() {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    },

    /**
     * Show view
     */
    showView(viewId, pushState = true) {
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
        // По ТЗ: шапка должна быть в товарах. На главной (категориях) и остальных - скрыта.
        const showHeaderViews = ['productsView'];

        if (!showHeaderViews.includes(viewId)) {
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

        // Reset scroll position to top
        this.scrollToTop();

        // Push state to browser history
        if (pushState) {
            window.history.pushState({ view: viewId }, '', '#' + viewId);
        }
    },

    /**
     * Foolproof scroll to top for all possible containers
     */
    scrollToTop() {
        // Standard window scroll
        window.scrollTo(0, 0);

        // Generic fallbacks
        document.body.scrollTop = 0;
        document.documentElement.scrollTop = 0;

        // Specific app containers
        const mainContent = document.getElementById('mainContent');
        if (mainContent) mainContent.scrollTop = 0;

        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.scrollTop = 0;
    },

    /**
     * Update nav active state
     */
    updateNavActiveState(viewId) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        if (viewId === 'categoriesView' || viewId === 'productsView') {
            const navCat = document.getElementById('navCategories');
            if (navCat) navCat.classList.add('active');
        } else if (viewId === 'cartView') {
            document.getElementById('navCart').classList.add('active');
        } else if (viewId === 'profileView') {
            document.getElementById('navProfile').classList.add('active');
        }
    },

    /**
     * Update Telegram back button
     */
    updateBackButton() {
        if (window.Telegram && Telegram.WebApp) {
            if (this.currentView !== 'productsView') {
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
            case 'productView':
            case 'profileView':
            case 'cartView':
                this.showCatalog();
                break;
            case 'checkoutView':
                this.showCart();
                break;
            default:
                this.showCatalog();
        }
    },

    /**
     * Show catalog (products view)
     */
    showCatalog() {
        this.showView('productsView');
    },

    /**
     * Show categories
     */
    showCategories() {
        this.showView('categoriesView');
    },

    /**
     * Show cart
     */
    async showCart() {
        this.showView('cartView');
        this.renderCart();

        // Validate cart on open and automatically clean up inactive/deleted items
        if (Cart.items && Cart.items.length > 0) {
            try {
                const validation = await API.validateCart(Cart.getApiItems());
                if (!validation.valid && validation.errors && validation.errors.length > 0) {
                    let removedNames = [];
                    validation.errors.forEach(err => {
                        if (err.error === "Товар не найден или недоступен") {
                            const cartItem = Cart.items.find(item => item.product.id === err.product_id);
                            const name = (cartItem && cartItem.product && cartItem.product.name)
                                || (err.product_name && err.product_name !== "Неизвестный товар" ? err.product_name : null)
                                || "Неизвестный товар";
                            Cart.items = Cart.items.filter(item => item.product.id !== err.product_id);
                            removedNames.push(name);
                        }
                    });

                    if (removedNames.length > 0) {
                        Cart.save();
                        this.renderCart();
                        this.updateCartBadge();
                        
                        let messageText = "";
                        if (removedNames.length <= 3) {
                            messageText = removedNames.join(', ');
                        } else {
                            const count = removedNames.length - 2;
                            const mod10 = count % 10;
                            const mod100 = count % 100;
                            let word = "товаров";
                            if (mod10 === 1 && mod100 !== 11) {
                                word = "товар";
                            } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
                                word = "товара";
                            }
                            messageText = `${removedNames.slice(0, 2).join(', ')} и еще ${count} ${word}`;
                        }
                        
                        this.showToast(`⚠️ Недоступные товары удалены из корзины: ${messageText}`);
                    }
                }
            } catch (e) {
                console.error("Cart auto-validation failed:", e);
            }
        }
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

        // Smart update: if item count is unchanged, just update qty/price in-place (no image flicker)
        const existingItems = container.querySelectorAll('.cart-item');
        if (existingItems.length === items.length) {
            items.forEach(item => {
                const el = container.querySelector(`.cart-item[data-id="${item.product.id}"]`);
                if (!el) return;
                const pieces = item.packs * (item.product.pieces_per_pack || 1);
                const subtotal = pieces * item.product.price_per_unit;
                const qtySpan = el.querySelector('.cart-item-qty');
                const priceSpan = el.querySelector('.cart-item-price');
                const decBtn = el.querySelector('[data-action="decrease"]');
                if (qtySpan) qtySpan.textContent = pieces;
                if (priceSpan) priceSpan.textContent = subtotal.toFixed(2) + '₽';
                if (decBtn) decBtn.disabled = item.packs <= 1;
            });
            document.getElementById('cartTotal').textContent = Cart.getTotal().toFixed(2) + '₽';
            return;
        }

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
                    <div class="cart-item-details">${item.packs} уп. (${item.product.pieces_per_pack || 1} шт./уп.) × ${item.product.price_per_unit}₽</div>
                    <div class="cart-item-controls">
                        <button class="cart-qty-btn" data-action="decrease" ${item.packs <= 1 ? 'disabled' : ''}>−</button>
                        <span class="cart-item-qty">${pieces}</span>
                        <button class="cart-qty-btn" data-action="increase">+</button>
                        <span class="cart-item-price">${subtotal.toFixed(2)}₽</span>
                        <button class="cart-item-remove" data-action="remove"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg></button>
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
            this.showToast('Введите Ф.И.О.');
            return;
        }
        if (!phone) {
            this.showToast('Введите телефон');
            return;
        }

        const orderData = {
            telegram_user_id: (this.user?.platform === 'whatsapp') ? 0 : (this.user?.id || 0),
            whatsapp_phone: (this.user?.platform === 'whatsapp') ? this.user.whatsapp_phone : null,
            platform: this.user?.platform ? this.user.platform : 'web',
            customer_name: name,
            customer_phone: phone,
            customer_organization: null,
            customer_comment: comment || null,
            items: items.map(item => ({
                product_id: item.product.id,
                quantity_packs: item.packs
            }))
        };

        try {
            const createdOrder = await API.createOrder(orderData);

            // Save order to guest_orders in localStorage if user is a guest (not authorized)
            if (!this.isAuthorized) {
                let localOrders = [];
                const saved = localStorage.getItem('guest_orders');
                if (saved) {
                    try {
                        localOrders = JSON.parse(saved);
                    } catch (e) {
                        console.error('Error parsing guest_orders from localStorage:', e);
                    }
                }
                if (!Array.isArray(localOrders)) {
                    localOrders = [];
                }
                localOrders.unshift(createdOrder);
                localStorage.setItem('guest_orders', JSON.stringify(localOrders));
            }

            Cart.clear();
            this.updateCartBadge();
            if (createdOrder.skipped_items && createdOrder.skipped_items.length > 0) {
                alert(`⚠️ Заказ оформлен!\n\nК сожалению, некоторые товары закончились на складе и были исключены из заказа:\n- ${createdOrder.skipped_items.join('\n- ')}\n\nИтоговая сумма заказа была автоматически пересчитана.`);
            } else {
                this.showToast('Заказ оформлен!');
            }
            this.showCatalog();

            // Request push notification subscription after order creation using customer phone
            if (phone) {
                const cleanedPhone = phone.replace(/\D/g, '');
                setTimeout(() => {
                    this.requestPushPermissionAndRegister(cleanedPhone);
                }, 1500);
            }

            setTimeout(() => {
                this.showView('profileView');
                this.loadOrders();
            }, 1000);

        } catch (error) {
            console.error('Order failed:', error);
            if (error.message && (error.message.includes("Товар не найден или недоступен") || error.message.includes("недоступны"))) {
                this.showToast('⚠️ Некоторые товары больше недоступны. Корзина обновлена.');
                await this.showCart();
                return;
            }
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
                ${order.customer_comment ? `
                <div class="order-detail-info-row" style="margin-top: 10px;">
                    <span class="order-detail-info-label">Комментарий к заказу:</span>
                    <span class="order-detail-info-value" style="font-style: italic;">${order.customer_comment}</span>
                </div>` : ''}
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
    },



    /**
     * Subscribe the active authorized user to push notifications
     */
    async subscribeToPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('Push notifications are not supported in this browser');
            return;
        }

        try {
            const reg = await navigator.serviceWorker.ready;
            let sub = await reg.pushManager.getSubscription();
            
            if (!sub) {
                const vapidPublicKey = 'BHr22VIKgYx9KHnTxFJqGea7GBzrBtFs7_1Aipz5ccBiazpWwmZ7Bgu5dF6cJHGHhNilScJtBQrMimtSP-hJbuU';
                const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
                
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: convertedVapidKey
                });
            }

            if (sub && this.user && this.user.whatsapp_phone) {
                await API.registerPushSubscription(sub, this.user.whatsapp_phone);
                console.log('Successfully registered Web Push subscription');
            }
        } catch (err) {
            console.error('Failed to subscribe to Push:', err);
        }
    },

    /**
     * Request push notification permission and register for specific phone
     */
    async requestPushPermissionAndRegister(phone) {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            return;
        }
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const reg = await navigator.serviceWorker.ready;
                let sub = await reg.pushManager.getSubscription();
                if (!sub) {
                    const vapidPublicKey = 'BHr22VIKgYx9KHnTxFJqGea7GBzrBtFs7_1Aipz5ccBiazpWwmZ7Bgu5dF6cJHGHhNilScJtBQrMimtSP-hJbuU';
                    const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: convertedVapidKey
                    });
                }
                if (sub) {
                    await API.registerPushSubscription(sub, phone);
                    console.log('Successfully registered Web Push for phone:', phone);
                }
            }
        } catch (err) {
            console.error('Error requesting push permission:', err);
        }
    },

    /**
     * Utility to convert VAPID public key
     */
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    },

    /**
     * Check if user device is iOS
     */
    isIOS() {
        const ua = navigator.userAgent;
        if (/Android/i.test(ua)) {
            return false;
        }
        return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    },

    /**
     * Check if PWA is launched in standalone mode
     */
    isStandalone() {
        return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    },

    /**
     * Check if running inside Telegram Mini App / Webview or WhatsApp Webview / Session
     */
    isInAppWebView() {
        const ua = navigator.userAgent;
        const urlParams = new URLSearchParams(window.location.search);
        
        // Telegram Mini App or User Agent
        const isTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData && window.Telegram.WebApp.initData.length > 0) || 
                           /Telegram/i.test(ua);
                           
        // WhatsApp User Agent or Session Parameter
        const isWhatsApp = /WhatsApp/i.test(ua) || 
                           urlParams.get('platform') === 'whatsapp' || 
                           (this.user && this.user.platform === 'whatsapp');
                           
        const isWrapper = ua.includes('KurortnikWrapper') || 
                          urlParams.get('wrapper') === 'true' || 
                          window.location.search.includes('wrapper=true');
                           
        return isTelegram || isWhatsApp || isWrapper;
    },

    /**
     * Handle In-App browser redirects and guidance overlay
     */
    handleInAppBrowser() {
        const ua = navigator.userAgent;
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;

        // If running inside our own KurortnikWrapper APK — never treat as in-app browser
        const isWrapper = ua.includes('KurortnikWrapper') || window.location.search.includes('wrapper=true');
        if (isWrapper) {
            return false;
        }

        // Check if we are inside a Telegram Mini App (strict check to avoid redirect loop inside Mini App)
        const isTelegramMiniApp = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData && window.Telegram.WebApp.initData.length > 0);
        if (isTelegramMiniApp) {
            return false;
        }

        // Detect in-app webview
        let isInApp = false;
        if (isAndroid) {
            isInApp = /Telegram|WhatsApp|FBAN|FBAV|Instagram/i.test(ua) || ua.includes('wv');
        } else if (isIOS) {
            isInApp = /Telegram|WhatsApp|FBAN|FBAV|Instagram/i.test(ua) || (!ua.includes('Safari') && !this.isStandalone());
        }

        if (!isInApp) {
            return false;
        }

        if (isAndroid) {
            // Show redirect overlay
            const redirectOverlay = document.getElementById('androidRedirectOverlay');
            if (redirectOverlay) {
                redirectOverlay.classList.remove('hidden');
                document.body.style.overflow = 'hidden';

                const currentUrl = window.location.href;
                const urlWithoutScheme = currentUrl.replace(/^https?:\/\//, '');
                const scheme = window.location.protocol.replace(':', '');
                const chromeIntent = `intent://${urlWithoutScheme}#Intent;scheme=${scheme};package=com.android.chrome;end`;

                const redirectLink = document.getElementById('androidRedirectLink');
                if (redirectLink) {
                    redirectLink.href = chromeIntent;
                }

                // Attempt automatic redirection
                window.location.replace(chromeIntent);
            }
            return true; // Stop initialization
        }

        if (isIOS) {
            // Show iOS guide overlay
            const guideOverlay = document.getElementById('iosInAppOverlay');
            if (guideOverlay) {
                guideOverlay.classList.remove('hidden');
                document.body.style.overflow = 'hidden';

                const closeBtn = document.getElementById('iosInAppCloseBtn');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        guideOverlay.classList.add('hidden');
                        document.body.style.overflow = '';
                    });
                }
            }
        }

        return false;
    },

    /**
     * Check and display iOS installation prompt banner
     */
    checkPWAInstallPrompt() {
        if (this.isStandalone() || this.isInAppWebView()) {
            return;
        }

        if (this.isIOS()) {
            const iosBannerDismissed = localStorage.getItem('ios_banner_dismissed');
            const oneWeek = 7 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            if (!iosBannerDismissed || (now - parseInt(iosBannerDismissed) > oneWeek)) {
                const banner = document.getElementById('pwaInstallBanner');
                const desc = document.getElementById('pwaInstallDescription');
                const actions = banner ? banner.querySelector('.pwa-install-actions') : null;
                
                if (banner && desc && actions) {
                    desc.innerHTML = 'Нажмите кнопку «Поделиться» <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><rect x="5" y="9" width="14" height="12" rx="2" ry="2"></rect><path d="M12 2v13M9 5l3-3 3 3"></path></svg> в Safari, затем выберите «На экран \"Домой\"» <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>.';
                    actions.style.display = 'none'; // No button on iOS
                    banner.classList.remove('hidden');
                    
                    const closeBtn = document.getElementById('pwaInstallCloseBtn');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => {
                            banner.classList.add('hidden');
                            localStorage.setItem('ios_banner_dismissed', Date.now().toString());
                        });
                    }
                }
            }
        }
    },

    /**
     * Display Android/Chrome PWA install prompt button
     */
    showAndroidInstallPrompt() {
        if (this.isInAppWebView() || this.isStandalone()) {
            return;
        }

        const androidBannerDismissed = localStorage.getItem('android_banner_dismissed');
        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        if (androidBannerDismissed && (now - parseInt(androidBannerDismissed) < oneWeek)) {
            return;
        }

        const banner = document.getElementById('pwaInstallBanner');
        const desc = document.getElementById('pwaInstallDescription');
        const actions = banner ? banner.querySelector('.pwa-install-actions') : null;
        const installBtn = document.getElementById('pwaInstallBtn');

        if (banner && desc && actions && installBtn) {
            desc.textContent = 'Установите приложение на экран телефона для быстрого доступа.';
            actions.style.display = 'flex';
            banner.classList.remove('hidden');

            // Handle click
            installBtn.onclick = async () => {
                if (this.deferredPrompt) {
                    this.deferredPrompt.prompt();
                    const { outcome } = await this.deferredPrompt.userChoice;
                    console.log(`User choice: ${outcome}`);
                    this.deferredPrompt = null;
                    banner.classList.add('hidden');
                }
            };

            const closeBtn = document.getElementById('pwaInstallCloseBtn');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    banner.classList.add('hidden');
                    localStorage.setItem('android_banner_dismissed', Date.now().toString());
                });
            }
        }
    },

    /**
     * Initialize backup PWA install button in Profile tab
     */
    initProfileInstallButton() {
        // Only show if not standalone PWA
        if (this.isStandalone()) {
            return;
        }

        // Only show on iOS or Android devices
        const isMobile = this.isIOS() || /Android/i.test(navigator.userAgent);
        if (!isMobile) {
            return;
        }

        // Exclude inside Telegram / WhatsApp webviews
        if (this.isInAppWebView()) {
            return;
        }

        const profileInstallSection = document.getElementById('profileInstallSection');
        const profileInstallBtn = document.getElementById('profileInstallBtn');

        if (profileInstallSection && profileInstallBtn) {
            profileInstallSection.style.display = 'block';

            profileInstallBtn.addEventListener('click', () => {
                if (this.isIOS()) {
                    // Show iOS install instructions banner (even if it was dismissed)
                    const banner = document.getElementById('pwaInstallBanner');
                    const desc = document.getElementById('pwaInstallDescription');
                    const actions = banner ? banner.querySelector('.pwa-install-actions') : null;
                    
                    if (banner && desc && actions) {
                        desc.innerHTML = 'Нажмите кнопку «Поделиться» <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><rect x="5" y="9" width="14" height="12" rx="2" ry="2"></rect><path d="M12 2v13M9 5l3-3 3 3"></path></svg> в Safari, затем выберите «На экран \"Домой\"» <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>.';
                        actions.style.display = 'none';
                        banner.classList.remove('hidden');
                        
                        this.showToast('Инструкция по установке открыта внизу экрана');
                    }
                } else {
                    // Android / Chrome
                    if (this.deferredPrompt) {
                        this.deferredPrompt.prompt();
                        this.deferredPrompt.userChoice.then(({ outcome }) => {
                            console.log(`User choice: ${outcome}`);
                            this.deferredPrompt = null;
                        });
                    } else {
                        // Show persistent banner with instructions for Chrome/Yandex
                        const banner = document.getElementById('pwaInstallBanner');
                        const desc = document.getElementById('pwaInstallDescription');
                        const actions = banner ? banner.querySelector('.pwa-install-actions') : null;
                        
                        if (banner && desc) {
                            desc.innerHTML = '<strong>Для установки приложения:</strong><br>' + 
                                             '• В <strong>Google Chrome</strong>: нажмите меню <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg> (вверху справа) ➡️ <strong>«Добавить на гл. экран»</strong>.<br>' + 
                                             '• В <strong>Яндекс Браузере</strong>: нажмите меню <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle; margin:0 2px;"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg> (внизу справа) ➡️ <strong>«Добавить ярлык на рабочий стол»</strong>.';
                            if (actions) actions.style.display = 'none'; // Hide install button
                            banner.classList.remove('hidden');
                            
                            const closeBtn = document.getElementById('pwaInstallCloseBtn');
                            if (closeBtn) {
                                closeBtn.addEventListener('click', () => {
                                    banner.classList.add('hidden');
                                });
                            }
                        }
                    }
                }
            });
        }
    },

    /**
     * Setup history state listener for hardware back button navigation
     */
    setupHistory() {
        // Set initial state
        window.history.replaceState({ view: 'categoriesView' }, '', '#categoriesView');
        this.currentView = 'categoriesView';

        window.addEventListener('popstate', (event) => {
            // 1. If any modal is active, close it and prevent navigating back
            const activeProductModal = document.getElementById('productModal')?.classList.contains('active');
            const activeOrderModal = document.getElementById('orderModal')?.classList.contains('active');
            const activeMenuModal = document.getElementById('catalogMenuModal')?.classList.contains('active');

            if (activeProductModal) {
                this.closeModal();
                // Push current state back to history to compensate for the pop
                window.history.pushState({ view: this.currentView }, '', '#' + this.currentView);
                return;
            }
            if (activeOrderModal) {
                this.closeOrderModal();
                window.history.pushState({ view: this.currentView }, '', '#' + this.currentView);
                return;
            }
            if (activeMenuModal) {
                Catalog.closeMenu();
                window.history.pushState({ view: this.currentView }, '', '#' + this.currentView);
                return;
            }

            // 2. Otherwise navigate to the popped view
            if (event.state && event.state.view) {
                this.showView(event.state.view, false); // false = do not push state again
            } else {
                this.showView('categoriesView', false);
            }
        });
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

// Make it global
window.App = App;
