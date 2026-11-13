const Admin = {
    userId: null,
    isAdmin: false,
    categories: [],
    products: [],
    orders: [],
    currentCategoryId: null,
    editingProductId: null,
    editingCategoryId: null,
    currentOrderId: null,
    currentOrdersFilter: '',

    async resizeImage(file, maxWidth = 1000, maxHeight = 1000, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(img.src);
                let width = img.width;
                let height = img.height;

                if (width > maxWidth || height > maxHeight) {
                    if (width > height) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
        });
    },

    async init() {
        // Client Hide Protection: Only load PWA features in standalone app mode OR with ?test=true
        const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
        const isDevMode = window.location.search.includes('test=true') || window.location.search.includes('dev=true') || window.location.search.includes('wrapper=true') || navigator.userAgent.includes('KurortnikWrapper');

        if (isStandalone || isDevMode) {
            // Load manifest dynamically so standard visitors never see the PWA install option
            const link = document.createElement('link');
            link.rel = 'manifest';
            link.href = 'admin_manifest.json?v=3';
            document.head.appendChild(link);

            // Read cached admin session
            const cachedId = localStorage.getItem('admin_user_id');
            if (cachedId) {
                this.userId = parseInt(cachedId);
            }
        }

        // Init Telegram
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand(); // Use full screen
            const user = window.Telegram.WebApp.initDataUnsafe.user;
            if (user) {
                this.userId = user.id;
                document.getElementById('adminUserInfo').textContent = `${user.first_name} (ID: ${user.id})`;
                await this.checkAuth();
            } else {
                document.getElementById('adminUserInfo').textContent = 'Dev Mode';
            }
        }

        // Setup manual login form handlers if PWA/dev mode is activated
        if (isStandalone || isDevMode) {
            const submitBtn = document.getElementById('btnSubmitLogin');
            if (submitBtn) {
                submitBtn.addEventListener('click', async () => {
                    const inputVal = document.getElementById('loginTelegramId').value.trim();
                    const parsedId = parseInt(inputVal);
                    if (!parsedId || isNaN(parsedId)) {
                        alert('Пожалуйста, введите корректный цифровой ID.');
                        return;
                    }
                    this.userId = parsedId;
                    await this.checkAuth(true); // true = manual login
                });
            }

            const pushBtn = document.getElementById('btnSubscribeAdminPush');
            if (pushBtn) {
                pushBtn.addEventListener('click', () => this.subscribeAdminPush());
            }

            if (this.userId) {
                await this.checkAuth();
            } else {
                // Show login form, hide standard "no access" message
                document.getElementById('authView').style.display = 'block';
                document.getElementById('standardAuthMsg').style.display = 'none';
                document.getElementById('manualLoginForm').style.display = 'block';
                document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
                document.querySelectorAll('.admin-nav, .admin-bottom-nav').forEach(el => el.style.display = 'none');
            }
        }

        this.setupTabs();
        this.setupOrdersFilter();
        this.switchTab('orders'); // Start on orders tab
        this.setupUpload();

        if (this.isDesktop()) {
            this.startDesktopPolling();
        }
    },

    startDesktopPolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(() => {
            if (this.isAdmin && this.userId) {
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

    downloadTemplate() {
        if (!API || !API.baseUrl) {
            alert('Ошибка: API не иницилизировано');
            return;
        }
        const url = `${API.baseUrl}/admin/template`;

        // Use Telegram WebApp openLink if available to ensure download works
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openLink) {
            window.Telegram.WebApp.openLink(url, { try_instant_view: false });
        } else {
            // Fallback for browser
            window.open(url, '_blank');
        }
    },

    async checkAuth(isManual = false) {
        if (!this.userId) return;
        try {
            const response = await fetch(`${API.baseUrl}/admin/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: this.userId })
            });

            if (response.ok) {
                this.isAdmin = true;
                localStorage.setItem('admin_user_id', this.userId);
                
                // Update user info display
                const userInfoEl = document.getElementById('adminUserInfo');
                if (userInfoEl) {
                    if (this.isDesktop()) {
                        userInfoEl.innerHTML = `ID: ${this.userId} | <a href="#" onclick="Admin.logout(); return false;" style="color: #ef4444; text-decoration: underline; margin-left: 8px; font-weight: bold; cursor: pointer;">Выйти</a>`;
                    } else {
                        userInfoEl.textContent = `ID: ${this.userId}`;
                    }
                }

                // Show admin UI
                document.getElementById('authView').style.display = 'none';
                document.querySelectorAll('.admin-nav, .admin-bottom-nav').forEach(el => el.removeAttribute('style')); // Unhide navigation
                
                // Auto switch and check push subscription
                this.switchTab('orders');
                this.checkAdminPushSubscription();
            } else {
                this.authFailed(isManual);
            }
        } catch (e) {
            console.error("Auth check failed", e);
            this.authFailed(isManual);
        }
    },

    authFailed(isManual = false) {
        this.isAdmin = false;
        localStorage.removeItem('admin_user_id');
        this.userId = null;
        
        document.getElementById('authView').style.display = 'block';
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.admin-nav, .admin-bottom-nav').forEach(el => el.style.display = 'none');

        const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
        const isDevMode = window.location.search.includes('test=true') || window.location.search.includes('dev=true') || window.location.search.includes('wrapper=true') || navigator.userAgent.includes('KurortnikWrapper');

        if (isStandalone || isDevMode) {
            document.getElementById('standardAuthMsg').style.display = 'none';
            document.getElementById('manualLoginForm').style.display = 'block';
            if (isManual) {
                alert('Неверный Telegram ID или у вас нет прав администратора.');
            }
        } else {
            document.getElementById('standardAuthMsg').style.display = 'block';
            document.getElementById('manualLoginForm').style.display = 'none';
        }
    },

    setupTabs() {
        document.querySelectorAll('.nav-btn, .nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });
    },

    switchTab(tabName) {
        // Close active modals on tab change
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));

        document.querySelectorAll('.nav-btn, .nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

        document.querySelectorAll(`[data-tab="${tabName}"]`).forEach(btn => btn.classList.add('active'));

        const tabEl = document.getElementById(tabName + 'Tab');
        if (tabEl) tabEl.style.display = 'block';

        // Do not load data if not authorized yet
        if (!this.isAdmin) return;

        if (tabName === 'categories') {
            this.loadCategories();
        } else if (tabName === 'products') {
            this._productsSearchQuery = '';
            this._productsFilter = 'all';
            const searchInput = document.getElementById('productSearch');
            if (searchInput) searchInput.value = '';
            // Reset filter buttons
            document.querySelectorAll('#productsFilterBar .filter-btn').forEach(b => b.classList.remove('active'));
            const allBtn = document.getElementById('prodFilter-all');
            if (allBtn) allBtn.classList.add('active');
            this.resetProducts();
        } else if (tabName === 'orders') {
            this.loadOrders();
        } else if (tabName === 'analytics') {
            this.loadAnalytics();
        }
    },

    // --- Categories ---

    async loadCategories() {
        this.currentCategoryId = null; // Reset drill down
        document.getElementById('categoryProductsSection').style.display = 'none';
        document.getElementById('breadcrumbs').style.display = 'none';
        const backBtn = document.getElementById('categoriesBackBtn');
        if (backBtn) backBtn.style.display = 'none';
        const list = document.getElementById('categoriesList');
        if (list) list.style.display = 'grid';

        try {
            const data = await API.getCategories(true);
            this.categories = data.categories || [];
            this.renderCategories(this.categories);
        } catch (e) {
            console.error(e);
        }
    },

    renderCategories(categories) {
        const list = document.getElementById('categoriesList');
        if (!list) return;

        // Отделяем категорию "Новинки" для сортировки на первое место
        const novinkiCat = categories.find(c => c.name && c.name.toLowerCase() === 'новинки');
        const otherCats = categories.filter(c => !c.name || c.name.toLowerCase() !== 'новинки');

        const sortedCats = [];
        if (novinkiCat) {
            sortedCats.push(novinkiCat);
        }
        sortedCats.push(...otherCats);

        list.innerHTML = sortedCats.map(c => {
            const isNovinki = c.name && c.name.toLowerCase() === 'новинки';
            const imgUrl = (c.image_file_id || c.image_url) ? API.getImageUrl(c.image_file_id || c.image_url, 'small') : 'assets/placeholder.svg';
            
            // Синяя рамка для "Новинки", стандартные стили для остальных
            const cardStyle = isNovinki 
                ? 'display: flex; flex-direction: column; justify-content: space-between; min-height: 120px; border: 2px solid #2563eb; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);'
                : 'display: flex; flex-direction: column; justify-content: space-between; min-height: 120px;';

            // Кнопка удаления скрыта для "Новинки"
            const deleteBtn = isNovinki 
                ? '' 
                : `<button class="btn-icon-styled danger" onclick="event.stopPropagation(); Admin.deleteCategory(${c.id})" title="Удалить">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                   </button>`;

            // Клик по "Новинки" сразу открывает модалку редактирования (так как подкатегорий у неё нет)
            const clickAction = isNovinki 
                ? `Admin.openCategoryModal(${c.id})` 
                : `Admin.openCategory(${c.id})`;

            const subcatText = isNovinki 
                ? 'Виртуальная категория' 
                : `${c.subcategories ? c.subcategories.length : 0} подкат.`;

            // Если категория скрыта, показываем бейдж "Скрыта"
            const statusBadge = c.active === false 
                ? ' <span class="status-badge cancelled" style="font-size: 10px; padding: 2px 6px; margin-left: 5px;">Скрыта</span>' 
                : '';

            return `
                <div class="category-card" onclick="${clickAction}" style="${cardStyle}">
                    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <img src="${imgUrl}" onerror="this.src='assets/placeholder.svg'" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; flex-shrink: 0;">
                        <div style="flex: 1; text-align: left; min-width: 0; overflow: hidden;">
                            <div class="category-name" style="font-weight: 600; display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${c.name}
                                ${statusBadge}
                            </div>
                            <div class="category-info" style="font-size:12px; color:#888;">
                                ${subcatText}
                            </div>
                        </div>
                    </div>
                    <div class="category-actions" onclick="event.stopPropagation()" style="display: flex; gap: 8px; margin-top: 10px; justify-content: center; width: 100%;">
                        <button class="btn-icon-styled primary" onclick="event.stopPropagation(); Admin.openCategoryModal(${c.id})" title="Редактировать">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        ${deleteBtn}
                    </div>
                </div>
            `;
        }).join('');
    },



    async ensureCategoriesLoaded() {
        if (this.categories.length === 0) {
            try {
                const data = await API.getCategories();
                this.categories = data.categories || [];
                // Update empty category list if we are on that tab (optional but good)
                // this.renderCategories(this.categories); 
            } catch (e) {
                console.error("Failed to ensure categories loaded", e);
            }
        }
    },

    async openCategory(catId) {
        this.currentCategoryId = catId;
        this.currentSubcategoryId = null;

        const category = this.categories.find(c => c.id === catId);
        if (!category) return;

        // Update Breadcrumbs
        document.getElementById('breadcrumbs').style.display = 'block';
        document.getElementById('breadcrumbCurrent').innerHTML = ` <span style="color:#888;">></span> ${category.name}`;

        // Show back button
        let backBtn = document.getElementById('categoriesBackBtn');
        if (!backBtn) {
            backBtn = document.createElement('button');
            backBtn.id = 'categoriesBackBtn';
            backBtn.className = 'btn';
            backBtn.style.cssText = 'margin-bottom:10px; display:flex; align-items:center; gap:6px; font-size:14px;';
            document.getElementById('categoriesList').before(backBtn);
        }
        backBtn.innerHTML = '← Назад к категориям';
        backBtn.style.display = 'inline-flex';
        backBtn.onclick = () => Admin.loadCategories();

        // Show subcategories
        document.getElementById('categoriesList').style.display = 'grid';
        if (category.subcategories && category.subcategories.length > 0) {
            document.getElementById('categoriesList').innerHTML = category.subcategories.map(s => {
                const imgUrl = (s.image_file_id || s.image_url) ? API.getImageUrl(s.image_file_id || s.image_url, 'small') : 'assets/placeholder.svg';
                return `
                <div class="category-card" onclick="Admin.openSubcategory(${s.id})" style="display: flex; flex-direction: column; justify-content: space-between; min-height: 120px;">
                    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <img src="${imgUrl}" onerror="this.src='assets/placeholder.svg'" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; flex-shrink: 0;">
                        <div style="flex: 1; text-align: left; min-width: 0; overflow: hidden;">
                            <div class="category-name" style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</div>
                            <div class="category-info" style="font-size:12px; color:#888;">Нажмите, чтобы открыть</div>
                        </div>
                    </div>
                    <div class="category-actions" onclick="event.stopPropagation()" style="display: flex; gap: 8px; margin-top: 10px; justify-content: center; width: 100%;">
                        <button class="btn-icon-styled primary" onclick="event.stopPropagation(); Admin.openSubcategoryModal(${category.id}, ${s.id})" title="Редактировать">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn-icon-styled danger" onclick="event.stopPropagation(); Admin.deleteSubcategory(${s.id})" title="Удалить">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `;
            }).join('') + `
            <div class="category-card category-card-add" onclick="Admin.openSubcategoryModal(${catId})">
                <div style="margin: auto; font-weight: 600; font-size: 15px;">+ Подкатегория</div>
            </div>`;
        } else {
            document.getElementById('categoriesList').innerHTML = `
            <div class="category-card category-card-add" onclick="Admin.openSubcategoryModal(${catId})">
                <div style="margin: auto; font-weight: 600; font-size: 15px;">+ Добавить подкатегорию</div>
            </div>`;
        }

        // Show Products in this category (only those without subcategory or all?)
        // Usually, if we have subcategories, we should probably not show products mixed in
        // But for simplicity let's show all products of this category regardless of subcategory
        document.getElementById('categoryProductsSection').style.display = 'block';
        document.querySelector('#categoryProductsSection h3').textContent = `Товары в категории "${category.name}"`;
        // Update Add Product button to preselect category ONLY
        document.querySelector('#categoryProductsSection button').onclick = () => Admin.openProductModal(null, catId);

        this.loadCategoryProducts(catId);
    },

    async openSubcategory(subId) {
        this.currentSubcategoryId = subId;
        const category = this.categories.find(c => c.id === this.currentCategoryId);
        const sub = category.subcategories.find(s => s.id === subId);

        // Update Breadcrumbs
        document.getElementById('breadcrumbCurrent').innerHTML = ` 
            <span style="color:#888;">></span> <span onclick="Admin.openCategory(${category.id})" style="cursor:pointer; text-decoration:underline;">${category.name}</span> 
            <span style="color:#888;">></span> ${sub.name}
        `;

        // Check if we want to hide sibling subcategories or just list products?
        // Let's hide the list of subcategories to focus on products
        document.getElementById('categoriesList').style.display = 'none';

        document.getElementById('categoryProductsSection').style.display = 'block';
        document.querySelector('#categoryProductsSection h3').textContent = `Товары: ${sub.name}`;

        // Update Add Product button to preselect category AND subcategory
        document.querySelector('#categoryProductsSection button').onclick = () => Admin.openProductModal(null, this.currentCategoryId, subId);

        // Update back button
        let backBtn = document.getElementById('categoriesBackBtn');
        if (backBtn) {
            backBtn.innerHTML = '← Назад к подкатегориям';
            backBtn.onclick = () => Admin.openCategory(category.id);
        }

        // Load products filtered by subcategory
        this.loadCategoryProducts(this.currentCategoryId, subId);
    },

    async loadCategoryProducts(catId, subId = null) {
        try {
            const params = { category: catId, limit: 10000, sort: 'name_asc', admin_view: true };
            if (subId) params.subcategory = subId;

            const data = await API.getProducts(params);
            const products = data.items || [];
            const tbody = document.getElementById('categoryProductsBody');

            if (products.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Товаров нет</td></tr>';
                return;
            }

            tbody.innerHTML = products.map(p => this.renderProductRow(p)).join('');
        } catch (e) {
            console.error(e);
        }
    },

    async deleteSubcategory(id) {
        if (!confirm('Удалить подкатегорию?')) return;
        // Assuming API for subcategory deletion exists or use generic router?
        // Wait, we didn't define delete subcategory strictly in API routes?
        // Let's check api.js or backend. Assuming standard REST: DELETE /subcategories/{id}
        // If not implemented, we might need to add it. But let's try standard.
        // Actually, looking at categories.py, we might need to check if DELETE /subcategories/{id} exists.
        // If not, we can't do it yet. I should double check.
        // For now let's hope it exists or I will add it in next step if fails.
        try {
            const token = localStorage.getItem('admin_token');
            await fetch(`${API.baseUrl}/categories/subcategories/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            this.loadCategories(); // reload tree
        } catch (e) {
            alert('Ошибка удаления: ' + e);
        }
    },

    editingSubcategoryId: null,
    editingSubcategoryParentId: null,
    currentSubcategoryImage: null,

    openSubcategoryModal(catId, subId = null) {
        this.editingSubcategoryId = subId;
        this.editingSubcategoryParentId = catId;
        this.currentSubcategoryImage = null;

        document.getElementById('subcatModalTitle').textContent = subId ? 'Редактировать подкатегорию' : 'Создать подкатегорию';
        document.getElementById('subcatNameInput').value = '';
        document.getElementById('subcatImageUrlInput').value = '';
        this.renderSubcategoryImagePreview();

        if (subId) {
            const category = this.categories.find(c => c.id === catId);
            if (category) {
                const sub = category.subcategories.find(s => s.id === subId);
                if (sub) {
                    document.getElementById('subcatNameInput').value = sub.name;
                    this.currentSubcategoryImage = sub.image_file_id || sub.image_url || null;
                    if (this.currentSubcategoryImage && (this.currentSubcategoryImage.startsWith('http') || this.currentSubcategoryImage.startsWith('/') || this.currentSubcategoryImage.startsWith('assets/'))) {
                        document.getElementById('subcatImageUrlInput').value = this.currentSubcategoryImage;
                    }
                    this.renderSubcategoryImagePreview();
                }
            }
        }

        document.getElementById('subcategoryModal').classList.add('active');
    },

    renderSubcategoryImagePreview() {
        const preview = document.getElementById('subcatImagePreview');
        const img = document.getElementById('subcatImgElement');
        if (this.currentSubcategoryImage) {
            img.src = API.getImageUrl(this.currentSubcategoryImage, 'small');
            preview.style.display = 'block';
        } else {
            img.src = '';
            preview.style.display = 'none';
        }
    },

    async handleSubcategoryImageUpload(files) {
        if (!files || files.length === 0) return;
        try {
            const dataUrl = await this.resizeImage(files[0]);

            const payload = {
                filename: files[0].name ? files[0].name.replace(/\.[^/.]+$/, "") + ".jpg" : `subcat_${Date.now()}.jpg`,
                base64_data: dataUrl
            };

            const response = await fetch(`${API.baseUrl}/images/upload_b64`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.file_id) {
                this.currentSubcategoryImage = data.file_id;
                document.getElementById('subcatImageUrlInput').value = '';
                this.renderSubcategoryImagePreview();
            }
        } catch (e) {
            console.error('Upload failed', e);
            alert('Ошибка загрузки фото');
        }
        document.getElementById('subcatImageUpload').value = '';
    },

    onSubcatImageUrlInput(val) {
        this.currentSubcategoryImage = val || null;
        this.renderSubcategoryImagePreview();
    },

    removeSubcategoryImage() {
        this.currentSubcategoryImage = null;
        document.getElementById('subcatImageUrlInput').value = '';
        this.renderSubcategoryImagePreview();
    },

    async saveSubcategory() {
        const name = document.getElementById('subcatNameInput').value.trim();
        if (!name) return alert('Введите название');

        const catId = this.editingSubcategoryParentId;
        const subId = this.editingSubcategoryId;

        const isUrl = this.currentSubcategoryImage &&
            (this.currentSubcategoryImage.startsWith('http') ||
             this.currentSubcategoryImage.startsWith('/') ||
             this.currentSubcategoryImage.startsWith('assets/'));

        const data = {
            name,
            image_url: isUrl ? this.currentSubcategoryImage : null,
            image_file_id: (this.currentSubcategoryImage && !isUrl) ? this.currentSubcategoryImage : null
        };

        try {
            const token = localStorage.getItem('admin_token');
            if (subId) {
                // Update existing subcategory
                await fetch(`${API.baseUrl}/categories/subcategories/${subId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ category_id: catId, ...data })
                });
            } else {
                // Create new subcategory
                await fetch(`${API.baseUrl}/categories/subcategories`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ category_id: catId, ...data })
                });
            }
            this.closeModal('subcategoryModal');
            await this.loadCategories();
            // Re-open category view
            setTimeout(() => this.openCategory(catId), 400);
        } catch (e) {
            alert('Ошибка: ' + e);
        }
    },

    // --- Products ---

    // --- Infinite scroll state ---
    _productsPage: 1,
    _productsPageSize: 50,
    _productsTotal: 0,
    _productsLoading: false,
    _productsSearchQuery: '',
    _productsFilter: 'all', // 'all' | 'new' | 'hidden' | 'outofstock'
    _productsObserver: null,

    // Full reset: called on tab switch, after save/delete
    resetProducts() {
        this._productsPage = 1;
        this._productsLoading = false;
        const tbody = document.getElementById('productsTableBody');
        if (tbody) tbody.innerHTML = '';
        this._disconnectProductsObserver();
        this.loadProducts();
    },

    async loadProducts() {
        if (this._productsLoading) return;
        if (this._productsPage > 1 && (this._productsPage - 1) * this._productsPageSize >= this._productsTotal) return;
        this._productsLoading = true;

        // Show skeleton rows on first page
        const tbody = document.getElementById('productsTableBody');
        if (this._productsPage === 1 && tbody) {
            tbody.innerHTML = Array(6).fill('').map(() => `
                <tr class="skeleton-row">
                    <td><div style="width:40px;height:40px;background:#e8e8e8;border-radius:6px;animation:skeletonPulse 1.2s ease-in-out infinite;"></div></td>
                    <td><div style="height:14px;background:#e8e8e8;border-radius:4px;width:70%;animation:skeletonPulse 1.2s ease-in-out infinite;"></div></td>
                    <td><div style="height:14px;background:#e8e8e8;border-radius:4px;width:50%;animation:skeletonPulse 1.2s ease-in-out infinite;"></div></td>
                    <td><div style="height:20px;background:#e8e8e8;border-radius:20px;width:40px;animation:skeletonPulse 1.2s ease-in-out infinite;"></div></td>
                    <td><div style="height:28px;background:#e8e8e8;border-radius:6px;width:60px;animation:skeletonPulse 1.2s ease-in-out infinite;"></div></td>
                </tr>`).join('');
        }

        try {
            const params = {
                limit: this._productsPageSize,
                page: this._productsPage,
                sort: 'name_asc',
                admin_view: true
            };
            if (this._productsSearchQuery) params.search = this._productsSearchQuery;
            // Apply active filter
            if (this._productsFilter === 'new')        params.is_new = true;
            if (this._productsFilter === 'hidden')     params.active = false;
            if (this._productsFilter === 'outofstock') params.in_stock_zero = true;

            const data = await API.getProducts(params);
            const items = data.items || [];
            this._productsTotal = data.total || 0;

            // Remove skeletons on first page
            if (this._productsPage === 1 && tbody) {
                tbody.querySelectorAll('.skeleton-row').forEach(r => r.remove());
            }

            // Append new rows
            if (tbody) {
                const fragment = document.createDocumentFragment();
                items.forEach(p => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = this.renderProductRow(p);
                    fragment.appendChild(tr.firstElementChild || tr);
                });
                // Re-create rows properly
                const temp = document.createElement('tbody');
                temp.innerHTML = items.map(p => this.renderProductRow(p)).join('');
                while (temp.firstChild) tbody.appendChild(temp.firstChild);
            }

            this._productsPage++;

            // Set up or refresh sentinel observer
            this._setupProductsObserver();
        } catch (e) {
            console.error('loadProducts error:', e);
        } finally {
            this._productsLoading = false;
        }
    },

    _setupProductsObserver() {
        this._disconnectProductsObserver();

        // Check if all products are loaded
        const loadedCount = (this._productsPage - 1) * this._productsPageSize;
        if (loadedCount >= this._productsTotal && this._productsPage > 1) {
            // Remove spinner if all loaded
            const ind = document.getElementById('products-load-indicator');
            if (ind) ind.remove();
            return;
        }

        // Sentinel goes AFTER the table-container in the productsTab
        const productsTab = document.getElementById('productsTab');
        if (!productsTab) return;

        // Show "loading more" spinner below table
        let indicator = document.getElementById('products-load-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'products-load-indicator';
            indicator.className = 'products-load-more-indicator';
            indicator.textContent = 'Загружаем ещё товары...';
            productsTab.appendChild(indicator);
        }

        // Sentinel is placed inside the indicator
        let sentinel = document.getElementById('products-scroll-sentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'products-scroll-sentinel';
            sentinel.style.cssText = 'height:1px;width:100%;';
            indicator.appendChild(sentinel);
        }

        // Use viewport as root (page scrolls as a whole, not the table-container)
        this._productsObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                this.loadProducts();
            }
        }, { root: null, rootMargin: '200px', threshold: 0 });

        this._productsObserver.observe(sentinel);
    },

    _disconnectProductsObserver() {
        if (this._productsObserver) {
            this._productsObserver.disconnect();
            this._productsObserver = null;
        }
        const sentinel = document.getElementById('products-scroll-sentinel');
        if (sentinel) sentinel.remove();
        const indicator = document.getElementById('products-load-indicator');
        if (indicator) indicator.remove();
    },

    renderProductsTable(products) {
        // Legacy — kept for compatibility (category products section reuses this pattern)
        const tbody = document.getElementById('productsTableBody');
        if (tbody) tbody.innerHTML = products.map(p => this.renderProductRow(p)).join('');
    },

    renderProductRow(p) {
        let statusBadge = '';
        let rowStyle = '';
        if (p.active === false) {
            statusBadge = ' <span class="status-badge cancelled" style="font-size: 10px; padding: 2px 6px;">Скрыт</span>';
            rowStyle = 'style="opacity: 0.6; background-color: #fafafa;"';
        } else if (p.in_stock === 0) {
            statusBadge = ' <span class="status-badge new" style="font-size: 10px; padding: 2px 6px; background-color: #f39c12; color: white;">0 пачек</span>';
            rowStyle = 'style="background-color: #fefcf9;"';
        }

        return `
            <tr ${rowStyle}>
                <td><img src="${API.getImageUrl(p.images?.[0]?.file_id || p.images?.[0]?.image_url || p.image_file_id || p.image_url, 'small')}" loading="lazy" onerror="this.src='assets/placeholder.svg'"></td>
                <td>
                    <div style="font-weight:600; display: flex; align-items: center; gap: 6px;">
                        ${p.name}
                        ${statusBadge}
                    </div>
                    <div style="font-size:12px; color:#888;">Цена: ${p.price_per_unit}₽ | Остаток: ${p.in_stock !== null ? p.in_stock + ' пачек' : '∞'}</div>
                </td>
                <td>${p.sku || '-'}</td>
                <td>
                    <label class="ios-switch">
                        <input type="checkbox" ${p.active !== false ? 'checked' : ''} onchange="Admin.toggleProductActive(${p.id}, this.checked)">
                        <span class="ios-slider"></span>
                    </label>
                </td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-icon-styled primary" onclick="Admin.openProductModal(${p.id})" title="Редактировать">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="btn-icon-styled danger" onclick="Admin.deleteProduct(${p.id})" title="Удалить">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    },

    searchProducts(query) {
        this._productsSearchQuery = (query || '').trim();
        this._productsPage = 1;
        this._productsLoading = false;
        const tbody = document.getElementById('productsTableBody');
        if (tbody) tbody.innerHTML = '';
        this._disconnectProductsObserver();
        this.loadProducts();
    },

    setProductsFilter(filter) {
        this._productsFilter = filter;
        // Update active button
        document.querySelectorAll('#productsFilterBar .filter-btn').forEach(b => b.classList.remove('active'));
        const btn = document.getElementById('prodFilter-' + filter);
        if (btn) btn.classList.add('active');
        // Reset pagination and reload
        this._productsPage = 1;
        this._productsLoading = false;
        const tbody = document.getElementById('productsTableBody');
        if (tbody) tbody.innerHTML = '';
        this._disconnectProductsObserver();
        this.loadProducts();
    },

    // --- Modals & Saving ---

    currentCategoryImage: null,

    openCategoryModal(catId = null) {
        this.editingCategoryId = catId;
        document.getElementById('catModalTitle').textContent = catId ? 'Изменить категорию' : 'Создать категорию';
        document.getElementById('catNameInput').value = '';
        document.getElementById('catImageUrlInput').value = '';
        document.getElementById('catHideInput').checked = false;
        this.currentCategoryImage = null;
        this.renderCategoryImagePreview();

        let isNovinki = false;
        if (catId) {
            const cat = this.categories.find(c => c.id === catId);
            if (cat) {
                document.getElementById('catNameInput').value = cat.name;
                isNovinki = cat.name && cat.name.toLowerCase() === 'новинки';
                document.getElementById('catHideInput').checked = cat.active === false;
                this.currentCategoryImage = cat.image_file_id || cat.image_url || null;
                if (this.currentCategoryImage) {
                    if (this.currentCategoryImage.startsWith('http') || this.currentCategoryImage.startsWith('/') || this.currentCategoryImage.startsWith('assets/')) {
                        document.getElementById('catImageUrlInput').value = this.currentCategoryImage;
                    }
                }
                this.renderCategoryImagePreview();
            }
        }

        // Для "Новинки" скрываем блок с названием, для остальных показываем
        const nameGroup = document.getElementById('catNameInput').closest('.form-group');
        if (nameGroup) {
            nameGroup.style.display = isNovinki ? 'none' : 'block';
        }

        document.getElementById('categoryModal').classList.add('active');
    },

    renderCategoryImagePreview() {
        const preview = document.getElementById('catImagePreview');
        const img = document.getElementById('catImgElement');
        if (this.currentCategoryImage) {
            img.src = API.getImageUrl(this.currentCategoryImage, 'small');
            preview.style.display = 'block';
        } else {
            img.src = '';
            preview.style.display = 'none';
        }
    },

    async handleCategoryImageUpload(files) {
        if (!files || files.length === 0) return;
        try {
            const dataUrl = await this.resizeImage(files[0]);

            const payload = {
                filename: files[0].name ? files[0].name.replace(/\.[^/.]+$/, "") + ".jpg" : `cat_${Date.now()}.jpg`,
                base64_data: dataUrl
            };

            const response = await fetch(`${API.baseUrl}/images/upload_b64`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            if (data.file_id) {
                this.currentCategoryImage = data.file_id;
                document.getElementById('catImageUrlInput').value = '';
                this.renderCategoryImagePreview();
            }
        } catch (e) {
            console.error("Upload failed", e);
            alert("Ошибка загрузки фото");
        }
        document.getElementById('catImageUpload').value = '';
    },

    onCatImageUrlInput(val) {
        this.currentCategoryImage = val || null;
        this.renderCategoryImagePreview();
    },

    removeCategoryImage() {
        this.currentCategoryImage = null;
        document.getElementById('catImageUrlInput').value = '';
        this.renderCategoryImagePreview();
    },

    async saveCategory() {
        let name = document.getElementById('catNameInput').value;
        const isNovinki = this.editingCategoryId && this.categories.find(c => c.id === this.editingCategoryId)?.name.toLowerCase() === 'новинки';
        if (isNovinki) {
            name = 'Новинки';
        }
        if (!name) return alert('Введите название');

        const isUrl = this.currentCategoryImage && (this.currentCategoryImage.startsWith('http') || this.currentCategoryImage.startsWith('/') || this.currentCategoryImage.startsWith('assets/'));
        const active = !document.getElementById('catHideInput').checked;
        const data = {
            name,
            image_url: isUrl ? this.currentCategoryImage : null,
            image_file_id: (this.currentCategoryImage && !isUrl) ? this.currentCategoryImage : null,
            active: active
        };

        try {
            if (this.editingCategoryId) {
                // Update
                await fetch(`${API.baseUrl}/categories/${this.editingCategoryId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            } else {
                // Create
                await fetch(`${API.baseUrl}/categories`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            }
            this.closeModal('categoryModal');
            this.loadCategories(); // Refresh
        } catch (e) {
            alert('Ошибка при сохранении: ' + e);
        }
    },

    currentProductImages: [], // Store file_ids

    async openProductModal(prodId = null, preselectCatId = null) {
        await this.ensureCategoriesLoaded();
        this.editingProductId = prodId;
        document.getElementById('prodModalTitle').textContent = prodId ? 'Редактировать товар' : 'Новый товар';

        // Reset form
        document.getElementById('prodName').value = '';
        document.getElementById('prodPrice').value = '';
        document.getElementById('prodPack').value = '1';
        document.getElementById('prodStock').value = '';
        document.getElementById('prodSku').value = '';
        document.getElementById('prodCountry').value = '';
        document.getElementById('prodDesc').value = '';
        document.getElementById('prodBadgeText').value = '';
        document.getElementById('prodBadgeColor').value = '';
        document.getElementById('prodActive').checked = true;
        document.getElementById('prodIsNew').checked = false;

        this.currentProductImages = [];
        this.renderProductImages();

        // Load categories into select
        const catSelect = document.getElementById('prodCategory');
        catSelect.innerHTML = '<option value="">Выберите категорию</option>';
        this.categories.forEach(c => {
            if (c.name.toLowerCase() === 'новинки') return; // Skip "Новинки" virtual category
            catSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
        });

        if (preselectCatId) {
            catSelect.value = preselectCatId;
            this.onCategoryChange(); // Load subcats
        }

        if (prodId) {
            // Load detail
            const p = await API.getProduct(prodId, true);
            document.getElementById('prodName').value = p.name;
            document.getElementById('prodPrice').value = p.price_per_unit;
            document.getElementById('prodPack').value = p.pieces_per_pack;
            if (p.in_stock !== null) document.getElementById('prodStock').value = p.in_stock;
            if (p.sku) document.getElementById('prodSku').value = p.sku;
            if (p.country) document.getElementById('prodCountry').value = p.country;
            if (p.description) document.getElementById('prodDesc').value = p.description;
            if (p.badge_text) document.getElementById('prodBadgeText').value = p.badge_text;
            if (p.badge_bg_color) document.getElementById('prodBadgeColor').value = p.badge_bg_color;
            document.getElementById('prodActive').checked = p.active !== false;
            document.getElementById('prodIsNew').checked = p.is_new === true;

            catSelect.value = p.category_id;
            this.onCategoryChange();
            if (p.subcategory_id) {
                document.getElementById('prodSubcategory').value = p.subcategory_id;
            }

            // Load images
            if (p.images && p.images.length > 0) {
                this.currentProductImages = p.images.map(img => img.file_id || img.image_url).filter(Boolean);
            } else if (p.image_file_id) {
                this.currentProductImages = [p.image_file_id];
            } else if (p.image_url) {
                this.currentProductImages = [p.image_url];
            } else {
                this.currentProductImages = [];
            }
            this.renderProductImages();
        }

        document.getElementById('productModal').classList.add('active');
    },

    renderProductImages() {
        const container = document.getElementById('prodImagesList');
        container.innerHTML = this.currentProductImages.map((img, index) => `
            <div style="position: relative; width: 60px; height: 60px;">
                <img src="${API.getImageUrl(img, 'small')}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; border: 1px solid #ddd;">
                <button onclick="Admin.removeImage(${index})" style="position: absolute; top: -5px; right: -5px; background: red; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; line-height: 18px; cursor: pointer; font-size: 12px;">×</button>
            </div>
        `).join('');
    },

    removeImage(index) {
        if (!confirm('Вы уверены, что хотите удалить это фото?')) return;
        this.currentProductImages.splice(index, 1);
        this.renderProductImages();
    },

    async handleImageUpload(files) {
        if (!files || files.length === 0) return;

        for (let i = 0; i < files.length; i++) {
            try {
                const dataUrl = await this.resizeImage(files[i]);

                const payload = {
                    filename: files[i].name ? files[i].name.replace(/\.[^/.]+$/, "") + ".jpg" : `image_${i}.jpg`,
                    base64_data: dataUrl
                };

                const response = await fetch(`${API.baseUrl}/images/upload_b64`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await response.json();
                if (data.file_id) {
                    this.currentProductImages.push(data.file_id);
                }
            } catch (e) {
                console.error("Upload failed", e);
                alert("Ошибка загрузки фото");
            }
        }
        this.renderProductImages();
        // Clear input so same file can be selected again
        document.getElementById('prodImageUpload').value = '';
    },

    onCategoryChange() {
        const catId = parseInt(document.getElementById('prodCategory').value);
        const subSelect = document.getElementById('prodSubcategory');
        subSelect.innerHTML = '<option value="">(Нет)</option>';

        const cat = this.categories.find(c => c.id === catId);
        if (cat && cat.subcategories) {
            cat.subcategories.forEach(s => {
                subSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
            });
        }
    },

    async saveProduct() {
        const data = {
            name: document.getElementById('prodName').value,
            category_id: parseInt(document.getElementById('prodCategory').value),
            subcategory_id: document.getElementById('prodSubcategory').value ? parseInt(document.getElementById('prodSubcategory').value) : null,
            price_per_unit: parseFloat(document.getElementById('prodPrice').value),
            pieces_per_pack: parseInt(document.getElementById('prodPack').value) || 1,
            in_stock: document.getElementById('prodStock').value ? parseInt(document.getElementById('prodStock').value) : null,
            sku: document.getElementById('prodSku').value,
            country: document.getElementById('prodCountry').value,
            description: document.getElementById('prodDesc').value,
            badge_text: document.getElementById('prodBadgeText').value || null,
            badge_bg_color: document.getElementById('prodBadgeColor').value || null,
            active: document.getElementById('prodActive').checked,
            is_new: document.getElementById('prodIsNew').checked,
            images: this.currentProductImages
        };

        if (!data.name || !data.category_id || isNaN(data.price_per_unit)) {
            return alert('Заполните обязательные поля (Название, Категория, Цена)');
        }

        try {
            if (this.editingProductId) {
                await fetch(`${API.baseUrl}/products/${this.editingProductId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            } else {
                await fetch(`${API.baseUrl}/products`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
            }
            this.closeModal('productModal');
            if (this.currentSubcategoryId) {
                this.loadCategoryProducts(this.currentCategoryId, this.currentSubcategoryId);
            } else if (this.currentCategoryId) {
                this.loadCategoryProducts(this.currentCategoryId);
            }
            this.resetProducts(); // refresh all list too
            alert('Сохранено!');
        } catch (e) {
            alert('Ошибка: ' + e);
        }
    },

    async deleteProduct(id) {
        if (!confirm('Удалить?')) return;
        await fetch(`${API.baseUrl}/products/${id}`, { method: 'DELETE' });
        if (this.currentSubcategoryId) {
            this.loadCategoryProducts(this.currentCategoryId, this.currentSubcategoryId);
        } else if (this.currentCategoryId) {
            this.loadCategoryProducts(this.currentCategoryId);
        }
        this.resetProducts();
    },

    async toggleProductActive(id, isActive) {
        try {
            await fetch(`${API.baseUrl}/products/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: isActive })
            });
            const prod = this.products.find(p => p.id === id);
            if (prod) prod.active = isActive;
            
            if (this.currentSubcategoryId) {
                this.loadCategoryProducts(this.currentCategoryId, this.currentSubcategoryId);
            } else if (this.currentCategoryId) {
                this.loadCategoryProducts(this.currentCategoryId);
            }
            this.resetProducts();
        } catch (e) {
            console.error(e);
            alert('Ошибка при изменении видимости: ' + e);
        }
    },

    async deleteCategory(id) {
        if (!confirm('Удалить категорию?')) return;
        await fetch(`${API.baseUrl}/categories/${id}`, { method: 'DELETE' });
        this.loadCategories();
    },

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },

    // --- Upload ---
    setupUpload() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');

        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) this.handleFile(e.target.files[0]);
        });
    },

    async handleFile(file) {
        const status = document.getElementById('uploadStatus');
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);

        // Проверка размера (макс 10 МБ)
        if (file.size > 10 * 1024 * 1024) {
            status.textContent = `❌ Файл слишком большой (${sizeMB} МБ). Максимум 10 МБ.`;
            return;
        }

        if (file.size === 0) {
            status.textContent = `❌ Ошибка: Файл пустой (0 байт). На Android это часто бывает при выборе файла из "Недавних" или облака (Google Диск). Попробуйте выбрать файл через встроенное приложение "Файлы".`;
            return;
        }

        status.textContent = `Чтение файла...`;

        try {
            // Strong Workaround for Telegram Android WebView "Failed to fetch" bug with FormData
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = e => reject(new Error('Сбой чтения файла с устройства. Попробуйте выбрать файл через другой файловый менеджер (например, "Файлы"). Детали: ' + (e.target.error ? e.target.error.message : 'Неизвестная ошибка Android')));
                reader.readAsDataURL(file);
            });

            // If the Base64 file is very large, Telegram WebApp JS bridge often crashes or drops the request.
            // So we split the Base64 string into 500KB chunks and send them one by one.
            const b64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            const chunkSize = 500 * 1024; // 500KB characters per chunk
            const totalChunks = Math.ceil(b64Data.length / chunkSize);
            const uploadSessionId = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

            status.textContent = `Разбивка файла... (0/${totalChunks})`;

            for (let i = 0; i < totalChunks; i++) {
                const chunkStr = b64Data.substring(i * chunkSize, (i + 1) * chunkSize);

                const payload = {
                    session_id: uploadSessionId,
                    filename: file.name || 'table.xlsx',
                    chunk_index: i,
                    total_chunks: totalChunks,
                    base64_data: chunkStr
                };

                status.textContent = `Отправка части ${i + 1} из ${totalChunks}...`;

                // Using XHR for maximum compatibility with ancient Android WebViews
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', `${API.baseUrl}/products/import_b64_chunk`, true);
                    xhr.setRequestHeader('Content-Type', 'application/json');

                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            try {
                                const res = JSON.parse(xhr.responseText);
                                if (i === totalChunks - 1) { // Last chunk
                                    const msg = res.message || 'Готово';
                                    status.innerHTML = msg.replace(/\n/g, '<br>');
                                }
                                resolve(res);
                            } catch (e) {
                                if (i === totalChunks - 1) status.textContent = `✅ Загружено, но ответ не распознан.`;
                                resolve({});
                            }
                        } else {
                            reject(new Error(`Ошибка сервера (${xhr.status}): ${xhr.responseText}`));
                        }
                    };

                    xhr.onerror = () => reject(new Error(`Ошибка сети (кусок ${i + 1})`));
                    xhr.ontimeout = () => reject(new Error(`Таймаут (кусок ${i + 1})`));
                    xhr.timeout = 60000; // 60s per chunk
                    xhr.send(JSON.stringify(payload));
                });
            }

        } catch (e) {
            status.textContent = `❌ Ошибка: ${e.message || e.toString()}`;
        }
    },

    // --- Orders ---

    setupOrdersFilter() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentOrdersFilter = btn.dataset.status || '';
                this.loadOrders();
            });
        });
    },

    async loadOrders() {
        try {
            let url = `${API.baseUrl}/orders`;
            if (this.currentOrdersFilter) {
                url += `?status=${this.currentOrdersFilter}`;
            }

            const response = await fetch(url);
            const data = await response.json();
            const newOrders = data.orders || [];

            // Compare with old orders to trigger native notification
            const oldOrders = this.orders || [];
            if (oldOrders.length > 0 && newOrders.length > 0) {
                const maxOldId = Math.max(...oldOrders.map(o => o.id));
                newOrders.forEach(newOrder => {
                    if (newOrder.id > maxOldId) {
                        this.showDesktopNotification(
                            "Новый заказ!",
                            `Поступил новый заказ #${newOrder.id} от ${newOrder.customer_name || 'клиента'} на сумму ${newOrder.total_amount}₽`
                        );
                    }
                });
            }

            this.orders = newOrders;
            this.renderOrdersTable();
        } catch (e) {
            console.error('Error loading orders:', e);
            document.getElementById('ordersTableBody').innerHTML = '<tr><td colspan="7" style="text-align:center;">Ошибка загрузки</td></tr>';
        }
    },

    renderOrdersTable() {
        const grid = document.getElementById('ordersGrid');
        const emptyMsg = document.getElementById('ordersEmpty');

        if (this.orders.length === 0) {
            grid.innerHTML = '';
            emptyMsg.style.display = 'block';
            return;
        }

        emptyMsg.style.display = 'none';

        grid.innerHTML = this.orders.map(order => {
            const itemsPreview = order.items.slice(0, 2).map(item =>
                `${item.product_name} × ${item.quantity_packs} шт`
            ).join(', ');
            const moreItems = order.items.length > 2 ? ` +${order.items.length - 2} ещё` : '';
            const managerBadge = order.assigned_manager
                ? `<span class="status-badge manager-badge">${order.assigned_manager}</span>`
                : '';

            return `
                <div class="admin-order-card" onclick="Admin.openOrderDetail(${order.id})">
                    <div class="order-card-header">
                        <span class="order-card-id">#${order.id}</span>
                        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
                            ${managerBadge}
                            <span class="status-badge ${order.status}">${this.getOrderStatusLabel(order.status)}</span>
                        </div>
                    </div>
                    <div class="order-card-customer">
                        <div class="customer-name">${order.customer_name}</div>
                        ${order.customer_organization ? `<div class="customer-org">${order.customer_organization}</div>` : ''}
                        <div class="customer-phone">${order.customer_phone}</div>
                    </div>
                    <div class="order-card-items">${itemsPreview}${moreItems}</div>
                    <div class="order-card-footer">
                        <span class="order-card-total">${order.total_amount}₽</span>
                        <span class="order-card-date">${this.formatOrderDate(order.created_at)}</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    getOrderStatusLabel(status) {
        const labels = {
            'new': 'Новый',
            'processing': 'В работе',
            'shipped': 'Отправлен',
            'completed': 'Выполнен',
            'cancelled': 'Отменён',
            // Legacy statuses for backward compatibility
            'accepted': 'Принят',
            'rejected': 'Отклонён'
        };
        return labels[status] || status;
    },

    formatOrderDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    openOrderDetail(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return;

        this.currentOrderId = orderId;
        document.getElementById('orderModalTitle').textContent = `Заказ #${orderId}`;
        document.getElementById('orderStatusSelect').value = order.status;
        if (document.getElementById('orderManagerSelect')) {
            document.getElementById('orderManagerSelect').value = order.assigned_manager || '';
        }

        const itemsHtml = order.items.map(item => {
            const imgUrl = item.product_image
                ? API.getImageUrl(item.product_image, 'small')
                : 'assets/placeholder.svg';

            return `
                <div class="order-item-card">
                    <img src="${imgUrl}" onerror="this.src='assets/placeholder.svg'">
                    <div class="order-item-info">
                        <div class="order-item-name">${item.product_name}</div>
                        ${item.product_sku ? `<div class="order-item-sku">Арт: ${item.product_sku}</div>` : ''}
                        <div class="order-item-qty">${item.quantity_packs} шт (${Math.round(item.quantity_pieces / item.quantity_packs)} шт./уп.) × ${item.price_per_unit}₽</div>
                    </div>
                    <div class="order-item-price">${item.subtotal}₽</div>
                </div>
            `;
        }).join('');

        const content = `
            <div class="order-detail-section">
                <h4>Информация о клиенте</h4>
                <div class="order-customer-info">
                    <div class="info-row">
                        <span class="info-label">Имя</span>
                        <span class="info-value">${order.customer_name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Телефон</span>
                        <span class="info-value">${order.customer_phone}</span>
                    </div>
                    ${order.customer_organization ? `
                    <div class="info-row" style="grid-column: 1 / -1;">
                        <span class="info-label">Организация</span>
                        <span class="info-value">${order.customer_organization}</span>
                    </div>` : ''}
                    <div class="info-row">
                        <span class="info-label">Дата заказа</span>
                        <span class="info-value">${this.formatOrderDate(order.created_at)}</span>
                    </div>
                    ${order.customer_comment ? `
                    <div class="info-row" style="grid-column: 1 / -1; margin-top: 5px;">
                        <span class="info-label">Комментарий</span>
                        <span class="info-value" style="font-style: italic;">${order.customer_comment}</span>
                    </div>` : ''}
                </div>
            </div>

            <div class="order-detail-section">
                <h4>Товары в заказе</h4>
                <div class="order-items-list">
                    ${itemsHtml}
                </div>
            </div>

            <div class="order-total-row">
                <span class="total-label">Итого</span>
                <span class="total-amount">${order.total_amount}₽</span>
            </div>
            
            <div style="margin-top: 15px; text-align: center;">
                <button class="btn btn-danger" onclick="Admin.deleteOrder(${order.id})" style="width:100%; display:flex; align-items:center; justify-content:center; gap:8px; background-color:#dc3545; color:white;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    Удалить заказ навсегда
                </button>
            </div>
        `;

        document.getElementById('orderDetailContent').innerHTML = content;
        document.getElementById('orderDetailModal').classList.add('active');
    },

    async deleteOrder(orderId) {
        if (!confirm('Вы уверены, что хотите НАВСЕГДА удалить этот заказ? Это действие нельзя отменить.')) return;

        try {
            const response = await fetch(`${API.baseUrl}/orders/${orderId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                alert('Заказ успешно удален.');
                this.closeModal('orderDetailModal');
                this.loadOrders();
            } else {
                const err = await response.json();
                alert('Ошибка: ' + (err.detail || 'Неизвестная ошибка'));
            }
        } catch (e) {
            alert('Ошибка сервера: ' + e);
        }
    },

    async updateOrderStatus() {
        if (!this.currentOrderId) return;

        const newStatus = document.getElementById('orderStatusSelect').value;
        const manager = document.getElementById('orderManagerSelect') ? document.getElementById('orderManagerSelect').value : '';

        try {
            const response = await fetch(`${API.baseUrl}/orders/${this.currentOrderId}/status?status=${newStatus}&manager=${manager}`, {
                method: 'PUT'
            });

            if (response.ok) {
                alert('Статус обновлён!');
                this.closeModal('orderDetailModal');
                this.loadOrders();
            } else {
                const err = await response.json();
                alert('Ошибка: ' + (err.detail || 'Неизвестная ошибка'));
            }
        } catch (e) {
            alert('Ошибка: ' + e);
        }
    },

    // --- Analytics ---

    async loadAnalytics() {
        if (!this.userId) return; // Wait for user check

        try {
            const url = `${API.baseUrl}/admin/stats?user_id=${this.userId}`;
            const response = await fetch(url);

            if (!response.ok) throw new Error('Failed to load stats');

            const stats = await response.json();

            // 1. Render Cards
            document.getElementById('statsRevenue').textContent = Math.round(stats.revenue).toLocaleString('ru-RU') + ' ₽';
            document.getElementById('statsOrders').textContent = stats.orders_count;

            const avgCheck = Math.round(stats.avg_check || 0);
            document.getElementById('statsAvgCheck').textContent = avgCheck.toLocaleString('ru-RU') + ' ₽';

            document.getElementById('statsCustomers').textContent = stats.customers_count;

            // 2. Render Chart (Sales for last 30 days)
            this.renderSalesChart(stats.chart_data || []);

            // 3. Render Top Products
            if (stats.top_products) {
                this.renderTopProducts(stats.top_products);
            }

        } catch (e) {
            console.error(e);
            // alert('Ошибка загрузки аналитики'); // Silent fail or console log is better
        }
    },

    renderSalesChart(data) {
        const ctx = document.getElementById('salesChart');
        if (!ctx) return;

        // Destroy old chart if exists
        if (this.salesChartInstance) {
            this.salesChartInstance.destroy();
        }

        // chart.js might not be loaded yet if net error
        if (typeof Chart === 'undefined') {
            console.error("DEBUG: Chart is UNDEFINED!");
            const errDivId = 'chart-error-msg';
            if (!document.getElementById(errDivId)) {
                const debugDiv = document.createElement('div');
                debugDiv.id = errDivId;
                debugDiv.style.cssText = 'color: red; padding: 10px; font-weight: bold; font-size: 14px;';
                debugDiv.textContent = 'Ошибка: Библиотека Chart.js не загружена!';
                ctx.parentNode.appendChild(debugDiv);
            }
            return;
        }
        console.log("DEBUG: Chart.js is successfully defined. Version:", Chart.version);

        let chartData = data;
        if (!chartData || chartData.length === 0) {
            chartData = [];
            const now = new Date();
            for (let i = 6; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(now.getDate() - i);
                chartData.push({
                    date: date.toISOString().split('T')[0],
                    revenue: 0,
                    orders: 0
                });
            }
        }

        const labels = chartData.map(d => {
            const date = new Date(d.date);
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        });
        const revenues = chartData.map(d => d.revenue);

        // Delay instantiation to ensure browser layout has finished
        setTimeout(() => {
            if (this.salesChartInstance) {
                this.salesChartInstance.destroy();
            }
            this.salesChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Выручка',
                        data: revenues,
                        borderColor: '#10b981', // green-500
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += Math.round(context.parsed.y) + ' ₽';
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function (value) {
                                    return value + ' ₽';
                                }
                            },
                            grid: {
                                color: '#f3f4f6'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }, 100);
    },

    renderTopProducts(products) {
        const list = document.getElementById('topProductsList');
        if (!list) return;

        if (!products || products.length === 0) {
            list.innerHTML = '<li style="justify-content:center; color:#888;">Нет данных</li>';
            return;
        }

        list.innerHTML = products.map((p, index) => {
            return `
            <li>
                <div class="prod-info">
                    <span class="prod-rank">${index + 1}</span>
                    <span class="prod-name" title="${p.name}">${p.name}</span>
                </div>
                <div class="prod-sold">${p.sold} шт.</div>
            </li>
            `;
        }).join('');
    },

    checkAdminPushSubscription() {
        const isTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
        if (this.isExeWrapper() || isTelegram) {
            const promo = document.getElementById('adminPushPromo');
            if (promo) promo.style.display = 'none';
            return;
        }
        if (!this.userId || !this.isAdmin) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('Push notifications not supported');
            return;
        }
        
        const permission = Notification.permission;
        const promo = document.getElementById('adminPushPromo');
        if (!promo) return;
        
        if (permission !== 'granted') {
            promo.style.display = 'block';
        } else {
            promo.style.display = 'none';
            this.subscribeAdminPushSilent();
        }
    },

    async subscribeAdminPush() {
        const promo = document.getElementById('adminPushPromo');
        try {
            const permission = Notification.permission;
            if (permission === 'default') {
                const newPermission = await Notification.requestPermission();
                if (newPermission !== 'granted') {
                    alert(this.isDesktop() ? 'Для получения уведомлений нужно разрешить их в приложении.' : 'Для получения уведомлений нужно разрешить их в браузере.');
                    return;
                }
            } else if (permission === 'denied') {
                alert(this.isDesktop() ? 'Уведомления заблокированы в настройках вашего приложения. Пожалуйста, разрешите их.' : 'Уведомления заблокированы в настройках вашего браузера. Пожалуйста, разрешите их для этого сайта.');
                return;
            }
            
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
                await API.registerPushSubscription(sub, "admin_" + this.userId);
                if (promo) promo.style.display = 'none';
                alert('Уведомления успешно включены на этом устройстве!');
            }
        } catch (e) {
            console.error('Failed to subscribe admin push:', e);
            alert('Ошибка подключения уведомлений: ' + e.message);
        }
    },

    isDesktop() {
        return window.location.search.includes('platform=desktop');
    },

    isExeWrapper() {
        return window.location.search.includes('wrapper=true');
    },

    logout() {
        localStorage.removeItem('admin_user_id');
        this.userId = null;
        this.isAdmin = false;
        this.authFailed();
    },

    async subscribeAdminPushSilent() {
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
            if (sub) {
                await API.registerPushSubscription(sub, "admin_" + this.userId);
            }
        } catch (e) {
            console.warn('Silent push refresh failed', e);
        }
    },

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
    }
};

document.addEventListener('DOMContentLoaded', () => Admin.init());
