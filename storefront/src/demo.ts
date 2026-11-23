import type {Category, Content} from './data';
import {products, sections} from './demo-catalog';

type Group = {id:number; parent_id:number|null; name:string; order:number; active:boolean; image:string|null};
type Item = {
  id:number; name:string; description:string|null; sku:string|null; country:string|null;
  badge_text:string|null; badge_bg_color:string|null; price_per_unit:number; pieces_per_pack:number;
  min_order_packs:number; in_stock:number|null; category_id:number; subcategory_id:number|null;
  active:boolean; is_new:boolean; images:string[]; updated_at:string;
};
type Line = {product_id:number; quantity_packs:number};
type Order = {
  id:number; created_at:string; status:string; manager:string|null; manager_id:number|null;
  name:string; phone:string; organization:string|null; comment:string|null; total:number; archived?:boolean;
  items:{id:number; name:string; sku:string|null; photo:string|null; packs:number; pieces:number; price:number; subtotal:number}[];
  history:{id:number; actor:string; status:string; created_at:string}[];
};
type State = {groups:Group[]; products:Item[]; orders:Order[]; content:Content; keys:Record<string,number>};
const storageKey = 'kurortnik-pages-demo-v1';
const sessionKey = 'kurortnik-pages-session-v1';
const staff = {id:1,name:'Демо-администратор',role:'admin',csrf:'demo'};
const picture = (cell:number) => import.meta.env.BASE_URL + 'images/demo/' + cell + '.webp';
const timestamp = () => new Date().toISOString();
const nextId = (items:{id:number}[]) => Math.max(0,...items.map(item=>Math.abs(item.id))) + 1;

function orderFrom(products:Item[], id:number, lines:Line[], status='new'):Order {
  const items = lines.map(({product_id,quantity_packs:packs})=>{
    const product = products.find(item=>item.id===product_id);
    if (!product || !product.active) throw new Error('Товар недоступен. Обновите корзину.');
    if (!Number.isInteger(packs) || packs<product.min_order_packs || packs>(product.in_stock??100000))
      throw new Error(`Проверьте количество упаковок товара «${product.name}».`);
    const pieces = packs * product.pieces_per_pack;
    return {id:product.id,name:product.name,sku:product.sku,photo:product.images[0]??null,packs,pieces,
      price:product.price_per_unit,subtotal:Math.round(pieces*product.price_per_unit*100)/100};
  });
  const created_at = timestamp();
  const assigned = status!=='new';
  return {id,created_at,status,manager:assigned?staff.name:null,manager_id:assigned?staff.id:null,
    name:'Демо-покупатель',phone:'+7 (000) 000-00-00',organization:'Магазин «У моря»',comment:'Тестовая заявка. Пример запроса на доставку.',
    total:items.reduce((sum,item)=>sum+item.subtotal,0),items,history:[{id:1,actor:'Демонстрация',status,created_at}]};
}

function initial():State {
  const groups:Group[] = sections.map((section,index)=>({id:index+1,parent_id:null,name:section.name,order:index,active:true,image:picture(section.photo)}));
  const items:Item[] = products.map((product,index)=>{
    const parent = sections.findIndex(section=>section.id===product.section)+1;
    let group = groups.find(item=>item.parent_id===parent && item.name===product.category);
    if (!group) {
      group={id:-nextId(groups),parent_id:parent,name:product.category,order:index,active:true,image:picture(product.photo)};
      groups.push(group);
    }
    return {id:index+1,name:product.name,description:product.description,sku:product.sku,country:null,badge_text:null,badge_bg_color:null,
      price_per_unit:product.price,pieces_per_pack:product.pack,min_order_packs:product.minimum,in_stock:product.available,
      category_id:parent,subcategory_id:-group.id,active:true,is_new:!!product.isNew,images:[picture(product.photo)],updated_at:timestamp()};
  });
  const content:Content = {
    title:'Курортник — витрина для оптовых покупателей',
    description:'Демонстрация магазина пляжных принадлежностей, летних товаров и сувениров.',
    banner_title:'Хороший сезон начинается здесь',
    banner_text:'Соберите летний ассортимент для магазина или торговой точки. Выбирайте товары и считайте закупку упаковками.',
    banner_image:'/images/hero.webp',conditions:'Товары заказывают упаковками. Фасовка и минимальное количество указаны в каталоге.',
    delivery:'В рабочем магазине менеджер согласует с покупателем адрес, сроки и стоимость доставки.',
    phone:'',email:'',address:'',steps:['Найдите товары в каталоге.','Укажите количество упаковок.','Проверьте корзину и оформите тестовую заявку.'],
    featured_ids:[1,3,6,9],offer_ids:[7,16],pages:{about:{title:'О компании',body:'«Курортник» — проект оптового магазина курортных товаров.'}},
  };
  return {groups,products:items,content,orders:[
    orderFrom(items,101,[{product_id:1,quantity_packs:2},{product_id:3,quantity_packs:3}]),
    orderFrom(items,102,[{product_id:8,quantity_packs:2},{product_id:2,quantity_packs:1}],'processing'),
    orderFrom(items,103,[{product_id:9,quantity_packs:2}],'completed'),
  ],keys:{}};
}

function load():State {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) as State : initial();
  } catch { return initial(); }
}

function save(state:State) {
  localStorage.setItem(storageKey,JSON.stringify(state));
  window.dispatchEvent(new Event('kurortnik-demo-change'));
}

function catalogProduct(product:Item, groups:Group[]) {
  return {
    ...product, category:groups.find(item=>item.id===product.category_id)?.name??'',
    price:product.price_per_unit, pack:product.pieces_per_pack, minimum:product.min_order_packs,
    available:product.in_stock, isNew:product.is_new, badge:product.badge_text,
  };
}

function categoryTree(groups:Group[]):Category[] {
  const ordered = groups.filter(group=>group.active).sort((a,b)=>a.order-b.order);
  return ordered.filter(group=>!group.parent_id).map(parent=>({...parent,subcategories:ordered
    .filter(child=>child.parent_id===parent.id).map(child=>({...child,id:-child.id,subcategories:[]}))}));
}

function page<T>(items:T[], number:string|null) {
  const offset = (Math.max(1,Number(number)||1)-1)*30;
  return {items:items.slice(offset,offset+30),total:items.length,pages:Math.max(1,Math.ceil(items.length/30))};
}

function available(product:Item) {
  return (product.in_stock??Infinity)>=product.min_order_packs;
}

function analytics(state:State) {
  const orders = state.orders.filter(order=>!order.archived && !['cancelled','rejected'].includes(order.status));
  const total = orders.reduce((sum,order)=>sum+order.total,0);
  const top = new Map<string,number>();
  const days = new Map<string,{date:string;total:number;count:number}>();
  for (const order of orders) {
    const date = order.created_at.slice(0,10);
    const current = days.get(date)??{date,total:0,count:0};
    days.set(date,{date,total:current.total+order.total,count:current.count+1});
    for (const line of order.items) top.set(line.name,(top.get(line.name)??0)+line.packs);
  }
  return {total,count:orders.length,average:orders.length?total/orders.length:0,customers:orders.length?1:0,
    products:state.products.length,categories:state.groups.filter(group=>!group.parent_id).length,
    new:orders.filter(order=>order.status==='new').length,completed:orders.filter(order=>order.status==='completed').length,
    confirmed_sum:orders.filter(order=>['accepted','completed'].includes(order.status)).reduce((sum,order)=>sum+order.total,0),
    days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    top:[...top].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,packs])=>({name,packs})),
  };
}

export function newDemoOrders() {
  return load().orders.filter(order=>!order.archived && order.status==='new').length;
}

export async function demoApi(path:string, options:RequestInit):Promise<unknown> {
  const url = new URL(path,'https://demo.invalid');
  const query = url.searchParams;
  const state = load();
  const endpoint = url.pathname;
  const method = options.method??'GET';
  const {groups,products,orders,content} = state;
  const visible = products.filter(product=>product.active && groups.some(group=>group.id===product.category_id && group.active)
    && (!product.subcategory_id || groups.some(group=>group.id===-(product.subcategory_id??0) && group.active)));
  const publicProduct = (product:Item) => catalogProduct(product,groups);
  const id = Number(endpoint.split('/').at(-1));
  const search = (product:Item) => [product.name,product.sku].some(value=>value?.toLocaleLowerCase('ru').includes((query.get('q')??'').trim().toLocaleLowerCase('ru')));

  if (endpoint==='/shop/home') return {content,categories:categoryTree(groups)};
  if (endpoint==='/shop/highlights') {
    const picks = (ids:number[]) => ids.flatMap(key=>visible.filter(item=>item.id===key && available(item))).map(publicProduct);
    return {featured:picks(content.featured_ids),offers:picks(content.offer_ids),
      newest:visible.filter(product=>product.is_new && available(product)).map(publicProduct)};
  }
  if (endpoint==='/shop/products' || endpoint==='/admin/products' && method==='GET') {
    const admin = endpoint.startsWith('/admin');
    if (admin && !sessionStorage.getItem(sessionKey)) throw new Error('Войдите в демо-админку.');
    const selected = Number(query.get('category'));
    const subcategory = Number(query.get('subcategory'));
    const filter = query.get('filter');
    const stock = query.get('stock');
    const country = query.get('country')?.toLocaleLowerCase('ru');
    const items = (admin?products:visible).filter(item=>search(item) &&
      (!selected || (selected>0?item.category_id===selected:item.subcategory_id===-selected)) &&
      (!subcategory || item.subcategory_id===subcategory) &&
      (!country || item.country?.toLocaleLowerCase('ru').includes(country)) &&
      (query.get('newest')!=='true' || item.is_new) &&
      (filter!=='new' || item.is_new) && (filter!=='hidden' || !item.active) &&
      (filter!=='out' || !available(item)) && (stock!=='yes' || available(item)) && (stock!=='no' || !available(item)));
    const sort = query.get('sort');
    items.sort((a,b)=>sort==='price_asc'?a.price_per_unit-b.price_per_unit:sort==='price_desc'?b.price_per_unit-a.price_per_unit:
      sort==='newest'?b.id-a.id:a.name.localeCompare(b.name,'ru'));
    return admin ? page(items,query.get('page')) : page(items.map(publicProduct),query.get('page'));
  }
  if (endpoint.startsWith('/shop/products/')) {
    const product = visible.find(item=>item.id===id);
    if (!product) throw new Error('Товар не найден.');
    return publicProduct(product);
  }
  if (endpoint==='/shop/cart-products') {
    const ids = (query.get('ids')??'').split(',').map(Number);
    return visible.filter(item=>ids.includes(item.id)).map(publicProduct);
  }
  if (endpoint==='/shop/orders' && method==='POST') {
    const {items} = JSON.parse(String(options.body)) as {items:Line[]};
    const key = new Headers(options.headers).get('Idempotency-Key');
    if (key && state.keys[key]) return {id:state.keys[key]};
    if (!items.length || new Set(items.map(line=>line.product_id)).size!==items.length) throw new Error('Проверьте товары в корзине.');
    const order = orderFrom(visible,nextId(orders),items);
    orders.unshift(order);
    if (key) state.keys[key]=order.id;
    for (const line of items) {
      const product=products.find(item=>item.id===line.product_id);
      if (product && product.in_stock!==null) product.in_stock-=line.quantity_packs;
    }
    save(state);
    return {id:order.id};
  }

  if (endpoint==='/admin/login' && method==='POST') {
    const data = JSON.parse(String(options.body));
    if (data.login?.trim()!=='admin' || data.password!=='admin') throw new Error('Неверный логин или пароль. Для показа используйте admin / admin.');
    sessionStorage.setItem(sessionKey,'1');
    return staff;
  }
  if (!sessionStorage.getItem(sessionKey)) throw new Error('Войдите в демо-админку.');
  if (endpoint==='/admin/session') return staff;
  if (endpoint==='/admin/logout') { sessionStorage.removeItem(sessionKey); return {ok:true}; }
  if (endpoint==='/admin/team') return [staff];
  if (endpoint==='/admin/analytics') return analytics(state);
  if (endpoint==='/admin/orders') {
    const status=query.get('status');
    return page(orders.filter(order=>!order.archived && (!status||order.status===status)),query.get('page'));
  }
  const orderRoute = endpoint.match(/^\/admin\/orders\/(\d+)(?:\/(claim|status))?$/);
  if (orderRoute) {
    const order=orders.find(item=>item.id===Number(orderRoute[1]) && !item.archived);
    if (!order) throw new Error('Заявка не найдена.');
    const action=orderRoute[2];
    if (method==='GET') return order;
    if (method==='DELETE') order.archived=true;
    if (action==='claim') {
      if (order.status!=='new') throw new Error('Заявка уже в работе.');
      order.manager=staff.name; order.manager_id=staff.id; order.status='processing';
    }
    if (action==='status') {
      const data=JSON.parse(String(options.body));
      order.status=data.status;
      if (data.manager_id!==undefined) {
        order.manager_id=data.manager_id||null; order.manager=data.manager_id?staff.name:null;
      }
    }
    order.history.push({id:nextId(order.history),actor:staff.name,status:order.status,created_at:timestamp()});
    save(state);
    return {ok:true};
  }
  if (endpoint==='/admin/categories' && method==='GET') return groups;
  if (endpoint==='/admin/content') {
    if (method==='GET') return content;
    state.content=JSON.parse(String(options.body)); save(state); return state.content;
  }
  if (endpoint.startsWith('/admin/categories')) {
    if (method==='DELETE') {
      const current=groups.find(item=>item.id===id);
      if (!current) throw new Error('Категория не найдена.');
      current.active=false;
      for (const product of products.filter(item=>id>0?item.category_id===id:item.subcategory_id===-id)) product.active=false;
    } else {
      const values=JSON.parse(String(options.body)) as Omit<Group,'id'>;
      const index=groups.findIndex(group=>group.id===id);
      if (index>=0) groups[index]={...values,id};
      else groups.push({...values,id:nextId(groups)*(values.parent_id?-1:1)});
    }
    save(state);
    return {ok:true};
  }
  if (endpoint.startsWith('/admin/products')) {
    if (method==='DELETE') {
      const current=products.find(item=>item.id===id);
      if (!current) throw new Error('Товар не найден.');
      current.active=false;
    } else if (endpoint.endsWith('/bulk')) {
      const values=JSON.parse(String(options.body)) as {ids:number[];active:boolean};
      for (const product of products.filter(item=>values.ids.includes(item.id))) product.active=values.active;
    } else {
      const values=JSON.parse(String(options.body)) as Item;
      const index=products.findIndex(product=>product.id===id);
      if (index>=0) products[index]={...values,id,updated_at:timestamp()};
      else products.push({...values,id:nextId(products),updated_at:timestamp()});
    }
    save(state);
    return {ok:true};
  }
  if (endpoint==='/admin/images') {
    const file=options.body instanceof FormData?options.body.get('file'):null;
    if (!(file instanceof File) || !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>500000)
      throw new Error('Для показа загрузите JPG, PNG или WebP до 500 КБ.');
    const image = await new Promise<string>((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Не удалось прочитать изображение.'));
      reader.onload=()=>resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    return {url:image};
  }
  throw new Error('Эта операция доступна в версии с сервером.');
}
