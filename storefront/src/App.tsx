import {lazy, Suspense, useEffect, useRef, useState, type FormEvent} from 'react';
import {Check, Phone, Search, ShoppingBag, Trash2} from 'lucide-react';
import {adminRoot, api, canOrder, demoMode, money, packLimit, phoneHref, type Category, type Content, type Product} from './data';
import {CartProvider, useCart} from './cart';
import {Breadcrumb, ConfirmDialog, Empty, Photo, ProductCard, Quantity} from './ui';
import PromotionCarousel from './PromotionCarousel';
import {collectionHref, collectionKeys, collections, isCollection, type Collection} from './collections';

const Admin = lazy(() => import('./admin'));
type ProductPageData = {items: Product[]; pages: number};

function useData<T>(path: string) {
  const [state, setState] = useState<{path: string; data?: T; error?: string}>();
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, {signal: controller.signal})
      .then(data => setState({path, data}))
      .catch((error: Error) => { if (!controller.signal.aborted) setState({path, error: error.message}); });
    return () => controller.abort();
  }, [path]);
  return state?.path === path ? state : undefined;
}

function useRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/');
  useEffect(() => {
    const change = () => { setRoute(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}

function Header({content, showSearch, home}: {content?: Content; showSearch: boolean; home: boolean}) {
  const {lines} = useCart();
  const [search, setSearch] = useState('');
  return <header className={`header${home?' header--home':''}`}><div className={`header-inner live-header${showSearch ? '' : ' live-header--without-search'}`}>
    <a href="#/" className="brand">курортник<span className="brand-dot">.</span><small>ОПТОВЫЙ МАГАЗИН</small></a>
    {showSearch&&<form className="search-field" onSubmit={event => {
      event.preventDefault();
      location.hash = '/catalog?q=' + encodeURIComponent(search.trim());
    }}>
      <Search size={20}/><input type="search" aria-label="Название или артикул" placeholder="Название или артикул" value={search} onChange={event => setSearch(event.target.value)}/>
      <button aria-label="Найти товар"><Search size={20}/></button>
    </form>}
    <nav aria-label="Основная навигация"><a href="#/catalog">Каталог</a><a href="#/conditions">Условия</a><a href="#/contacts">Контакты</a></nav>
    <div className="header-actions">
      {content?.phone && <a className="header-phone" href={phoneHref(content.phone)} aria-label={'Позвонить ' + content.phone}><Phone size={20}/></a>}
      <a className="cart-link" href="#/cart"><ShoppingBag size={20}/><span>Корзина</span><b aria-label={`${lines.reduce((sum, line) => sum + line.packs, 0)} упаковок`}>{lines.reduce((sum, line) => sum + line.packs, 0)}</b></a>
    </div>
  </div>{home && demoMode && <DemoNote/>}</header>;
}

function DemoNote() {
  return <div className="demo-banner">Демо-витрина. Цены и фасовка тестовые, заявки сохраняются в этом браузере.</div>;
}

function Footer({content}: {content?: Content}) {
  return <footer className="footer"><div className="container footer-main">
    <div><a href="#/" className="brand">курортник.</a><p>Курортные товары оптом</p></div>
    <div><h3>Покупателям</h3><a href="#/catalog">Каталог</a><a href="#/cart">Корзина</a><a href="#/conditions">Условия и доставка</a><a href={adminRoot}>Для сотрудников</a></div>
    <div><h3>Информация</h3><a href="#/contacts">Контакты</a>{Object.entries(content?.pages ?? {}).map(([slug, page]) => <a key={slug} href={'#/info/' + slug}>{page.title}</a>)}</div>
    <div><h3>Связь с магазином</h3>{content?.phone && <a href={phoneHref(content.phone)}>{content.phone}</a>}{content?.email && <a href={'mailto:' + content.email}>{content.email}</a>}{content?.address && <p>{content.address}</p>}</div>
  </div></footer>;
}

function Feedback({error}: {error?: string}) {
  return error ? <p role="alert" className="error-text">{error}</p> : <p role="status">Загрузка…</p>;
}

function CategoryTile({name, image, href}: {name: string; image: string | null; href: string}) {
  return <a className="category-tile" href={href}>
    <Photo src={image} alt=""/>
    <div><h3>{name}</h3></div>
  </a>;
}

function Home({content, categories}: {content: Content; categories: Category[]}) {
  const groups = useData<{featured: Product[]; offers: Product[]; newest: Product[]}>('/shop/highlights');
  return <>
    <section className="container section home-categories"><h2>Категории товаров</h2><div className="categories">
      {categories.map(category => <CategoryTile key={category.id} name={category.name} image={category.image} href={`#/catalog?category=${category.id}`}/>)}
    </div></section>
    {groups?.data ? ([['hits', groups.data.featured], ['new', groups.data.newest], ['sale', groups.data.offers]] as const)
      .filter(([, products]) => products.length)
      .map(([key, products]) => <section key={key} className="container section">
        <div className="collection-heading"><h2>{collections[key].title}</h2><a className="underline-link" href={collectionHref(key)}>Вся подборка</a></div>
        <div className="product-grid home-grid">{products.slice(0,4).map(product => <ProductCard key={product.id} p={product} collection={key}/>)}</div>
      </section>) : <div className="container"><Feedback error={groups?.error}/></div>}
    <section className="container section how-section"><h2>Как оформить заявку</h2>
      <ol className="steps live-steps">{content.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
      <p>{content.conditions}</p><a href="#/conditions" className="underline-link">Условия закупки и доставки</a>
    </section>
    <section className="container section promotion-intro">
      <div><h2>{content.banner_title}</h2><p>{content.banner_text}</p><a className="underline-link" href="#/catalog">Открыть каталог</a></div>
      {content.banner_image && <Photo src={content.banner_image} alt="Курортный ассортимент"/>}
    </section>
  </>;
}

function showsCatalogProducts(query: URLSearchParams) {
  return query.get('all') === '1' || !!query.get('category') || !!query.get('q')?.trim() || query.get('new') === '1';
}

function Catalog({query, categories}: {query: URLSearchParams; categories: Category[]}) {
  const collection = query.get('collection');
  if (isCollection(collection) || showsCatalogProducts(query)) {
    return <CatalogProducts query={query} categories={categories} collection={isCollection(collection) ? collection : undefined}/>;
  }

  return <div className="container catalog-page">
    <Breadcrumb name="Каталог"/>
    <h1>Каталог товаров</h1>
    <nav className="catalog-collections" aria-label="Подборки товаров">
      {collectionKeys.map(key => <a key={key} className={`catalog-collection catalog-collection--${key}`} href={collectionHref(key)}>{collections[key].title}</a>)}
    </nav>
    <nav className="categories catalog-categories" aria-label="Категории каталога">
      <CategoryTile name="Все товары" image="/images/hero.webp" href="#/catalog?all=1"/>
      {categories.map(category => <CategoryTile key={category.id} name={category.name} image={category.image} href={`#/catalog?category=${category.id}`}/>)}
    </nav>
  </div>;
}

function CatalogProducts({query, categories, collection}: {query: URLSearchParams; categories: Category[]; collection?: Collection}) {
  const [draft, setDraft] = useState(query.get('q') ?? '');
  const [search, setSearch] = useState(draft);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const category = query.get('category');
  const newOnly = query.get('new') === '1';
  const filters = new URLSearchParams({q:search, sort, newest:String(newOnly), page:String(page)});
  if (category) filters.set('category', category);
  if (collection) filters.set('collection', collection);
  const result = useData<ProductPageData>('/shop/products?' + filters);
  const selectedCategory = categories.find(item => String(item.id) === category);
  const title = collection ? collections[collection].title : selectedCategory?.name ?? (search ? 'Результаты поиска' : newOnly ? 'Новинки' : 'Все товары');

  return <div className="container catalog-page"><Breadcrumb name={title} parent="Каталог"/><h1>{title}</h1>
    <form className="catalog-controls" onSubmit={event => {
      event.preventDefault();
      setSearch(draft.trim());
      setPage(1);
    }}>
      <div className="search-field">
        <input type="search" aria-label="Поиск по названию или артикулу" placeholder="Поиск" value={draft} onChange={event => setDraft(event.target.value)}/>
        <button className="button" type="submit" aria-label="Найти товар"><Search size={20}/></button>
      </div>
      <select aria-label="Сортировка товаров" value={sort} onChange={event => {setSort(event.target.value); setPage(1);}}>
        <option value="name">По названию</option>
        <option value="price_asc">Дешевле</option>
        <option value="price_desc">Дороже</option>
        <option value="newest">Новинки</option>
      </select>
    </form>
    {!result?.data ? <Feedback error={result?.error}/> : result.data.items.length
      ? <div className="product-grid">{result.data.items.map(product => <ProductCard key={product.id} p={product} collection={collection}/>)}</div>
      : <p>Товары по этим условиям не найдены.</p>}
    {result?.data && result.data.pages > 1 && <nav className="pagination" aria-label="Страницы каталога"><button disabled={page===1} onClick={()=>setPage(page-1)}>Назад</button><span>{page} из {result.data.pages}</span><button disabled={page>=result.data.pages} onClick={()=>setPage(page+1)}>Далее</button></nav>}
  </div>;
}

function ProductPage({id}: {id: string}) {
  const result = useData<Product>('/shop/products/' + encodeURIComponent(id));
  return <div className="container product-page">{result?.data ? <ProductDetails product={result.data}/> : <Feedback error={result?.error}/>}</div>;
}

function ProductDetails({product}: {product: Product}) {
  const [photo, setPhoto] = useState(0);
  return <><Breadcrumb name={product.name} parent="Каталог"/><div className="product-detail">
    <div><Photo src={product.images[photo]} alt={product.name} eager/>{product.images.length > 1 && <div className="gallery-thumbs">{product.images.map((src,index)=><button key={src} onClick={()=>setPhoto(index)} aria-label={`Фотография ${index+1}`} aria-pressed={photo===index}><Photo src={src} alt=""/></button>)}</div>}</div>
    <div><h1>{product.name}</h1>{product.country && <p>Страна: {product.country}</p>}<ProductCard p={product} detail/>
      {product.referenceUrl && <a href={product.referenceUrl} className="underline-link" target="_blank" rel="noreferrer">Описание модели в источнике</a>}
    </div>
  </div></>;
}

function CartPage() {
  const {lines, setPacks, remove, clear} = useCart();
  const ids = lines.map(line => line.id).join(',');
  const result = useData<Product[]>('/shop/cart-products?ids=' + ids);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [number, setNumber] = useState<number>();
  const attempt = useRef<{fingerprint: string; key: string} | null>(null);
  const submitting = useRef(false);
  const items = lines.map(line => ({...line, product: result?.data?.find(product => product.id === line.id)}));
  const invalid = items.some(({product,packs}) => !product || !canOrder(product) || packs < product.minimum || packs > packLimit(product));
  const total = items.reduce((sum, item) => sum + (item.product ? item.product.price * item.product.pack * item.packs : 0), 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || invalid || !lines.length) return;
    const body = JSON.stringify({...Object.fromEntries(new FormData(event.currentTarget)), items:lines.map(line => ({product_id:line.id,quantity_packs:line.packs}))});
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      const fingerprint = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
      if (attempt.current?.fingerprint !== fingerprint) {
        let previous: {fingerprint: string; key: string} | undefined;
        try { previous = JSON.parse(sessionStorage.getItem('kurortnik-submission') ?? 'null'); } catch { /* In-memory retry remains available. */ }
        attempt.current = previous?.fingerprint === fingerprint ? previous : {fingerprint,key:crypto.randomUUID()};
        try { sessionStorage.setItem('kurortnik-submission',JSON.stringify(attempt.current)); } catch { /* Storage may be blocked. */ }
      }
      const response = await api<{id:number}>('/shop/orders', {method:'POST', body, headers:{'Idempotency-Key':attempt.current.key}});
      try { sessionStorage.removeItem('kurortnik-submission'); } catch { /* Storage may be blocked. */ }
      setNumber(response.id); clear();
    } catch (err) { setError((err as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (number) return <div className="container info-page"><h1>{demoMode?'Тестовая заявка создана':'Заявка отправлена'}</h1>
    <p role="status">{demoMode?`Заявка №${number} сохранена в этом браузере и видна в демо-админке.`:`Заявка №${number} успешно отправлена. Наш менеджер свяжется с вами для подтверждения наличия, стоимости и условий доставки.`}</p>
    {demoMode&&<p><a href={adminRoot+'?order='+number} className="button secondary">Посмотреть в демо-админке</a></p>}<a className="button" href="#/catalog">Вернуться в каталог</a></div>;
  if (!lines.length) return <div className="container info-page"><Empty title="Корзина пуста" text="Добавьте товары из каталога."/></div>;
  return <div className="container cart-page"><Breadcrumb name="Корзина"/><h1>Корзина</h1>
    {!result?.data ? <Feedback error={result?.error}/> : <div className="cart-layout"><div className="live-cart-lines">
      {items.map(({product,id,packs}) => <article key={id} className="live-cart-line">
        {product && <Photo src={product.images[0]} alt={product.name}/>}
        <div><h2>{product?.name ?? `Товар №${id}`}</h2>{product && <><p>{packs} уп. × {product.pack} шт. = {packs*product.pack} шт.</p><strong>{money(packs*product.pack*product.price)}</strong></>}
        {product && canOrder(product) && !busy ? <Quantity value={packs} min={product.minimum} max={packLimit(product)} label={'Упаковок товара ' + product.name} onChange={value=>setPacks(id,value)}/> : !busy && <p>Товар сейчас недоступен.</p>}
        </div><button type="button" className="icon-button" aria-label={'Убрать ' + (product?.name ?? id)} disabled={busy} onClick={()=>remove(id)}><Trash2 size={20}/></button>
      </article>)}
      <button className="button secondary" disabled={busy} onClick={()=>setConfirm(true)}>Очистить корзину</button>
    </div><form className="summary live-form" onSubmit={submit}>
      <h2>Оформление заявки</h2><p>Ориентировочная сумма <strong>{money(total)}</strong></p>
      {demoMode ? <p>Проверка оформления пройдёт с тестовым покупателем. Вводить свои контакты не нужно.</p> : <>
      <label>Имя<input name="name" autoComplete="name" required maxLength={255}/></label>
      <label>Телефон<input name="phone" type="tel" autoComplete="tel" required maxLength={30}/></label>
      <label>Организация <small>(необязательно)</small><input name="organization" autoComplete="organization" maxLength={255}/></label>
      <label>Комментарий <small>(необязательно)</small><textarea name="comment" maxLength={2000}/></label>
      </>}
      {invalid && <p role="alert">Проверьте количество упаковок и уберите недоступные товары.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <button className="button" disabled={busy||invalid}>{busy ? 'Сохраняем…' : demoMode ? 'Создать тестовую заявку' : 'Отправить заявку'}</button>{!demoMode&&<p>Менеджер уточнит наличие, стоимость и доставку по телефону.</p>}
    </form></div>}
    <ConfirmDialog open={confirm} onClose={()=>setConfirm(false)} onConfirm={clear}/>
  </div>;
}

function Info({path, content}: {path: string; content: Content}) {
  const page = content.pages[path.slice('/info/'.length)];
  if (path === '/contacts') return <div className="container info-page"><Breadcrumb name="Контакты"/><h1>Контакты</h1>{content.phone&&<p><a href={phoneHref(content.phone)}>{content.phone}</a></p>}{content.email&&<p><a href={'mailto:'+content.email}>{content.email}</a></p>}{content.address&&<p>{content.address}</p>}<a className="button" href="#/cart">К корзине</a></div>;
  if (path === '/conditions') return <div className="container info-page"><Breadcrumb name="Условия заказа"/><h1>Условия заказа</h1><p className="long-text">{content.conditions}</p><h2>Доставка</h2><p className="long-text">{content.delivery}</p></div>;
  if (page) return <div className="container info-page"><Breadcrumb name={page.title}/><h1>{page.title}</h1><p className="long-text">{page.body}</p></div>;
  return <div className="container"><Empty title="Страница не найдена" text="Откройте каталог, чтобы продолжить."/></div>;
}

function Site() {
  const route = useRoute();
  const [path, search] = route.split('?');
  const home = path === '/';
  const query = new URLSearchParams(search);
  const landing = useData<{content: Content; categories: Category[]}>('/shop/home');
  const {notice} = useCart();
  const main = useRef<HTMLElement>(null);
  const initial = useRef(true);
  const content = landing?.data?.content;
  useEffect(() => {
    if (initial.current) initial.current = false; else main.current?.focus({preventScroll:true});
  }, [route]);
  useEffect(() => {
    if (!content) return;
    document.title = path === '/' ? content.title : `${content.pages[path.slice(6)]?.title ?? 'Оптовый магазин'} — Курортник`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', content.description);
  }, [path,content]);
  return <><a className="skip-link" href="#main" onClick={event=>{event.preventDefault();main.current?.focus();}}>Перейти к содержимому</a>
    {home ? <PromotionCarousel/> : demoMode && <DemoNote/>}
    <Header content={content} home={home} showSearch={path !== '/catalog' || !showsCatalogProducts(query)}/><main id="main" ref={main} tabIndex={-1}>
      {path === '/cart' || path === '/checkout' ? <CartPage/> : path.startsWith('/product/') ? <ProductPage key={path} id={path.split('/')[2]}/> : !landing?.data ? <div className="container info-page"><Feedback error={landing?.error}/></div>
        : path === '/' ? <Home {...landing.data}/> : path === '/catalog' ? <Catalog key={route} query={query} categories={landing.data.categories}/> : <Info path={path} content={landing.data.content}/>}
    </main><Footer content={content}/><div className={`toast ${notice?'toast--visible':''}`} role="status">{notice&&<><Check size={20}/><span>{notice}</span><a href="#/cart">К корзине</a></>}</div></>;
}

export default function App() {
  if (location.pathname.replace(/\/$/, '') === adminRoot.replace(/\/$/, '') || (!demoMode && location.pathname.startsWith('/admin/'))) return <Suspense fallback={<p role="status">Загрузка админки…</p>}><Admin/></Suspense>;
  return <CartProvider><Site/></CartProvider>;
}
