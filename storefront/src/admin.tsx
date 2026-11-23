import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {BarChart3, Bell, ClipboardList, FileSpreadsheet, FolderTree, LayoutTemplate, LogOut, Package, Phone} from 'lucide-react';
import {api, money, phoneHref, setCsrf, type Content} from './data';
import './admin.css';

type Staff = {id:number; name:string; role:'admin'|'manager'; csrf:string};
type Order = {
  id:number; created_at:string; status:string; manager:string|null; manager_id:number|null;
  name:string; phone:string; organization:string|null; comment:string|null; total:number;
  items:{id:number; name:string; sku:string|null; photo:string|null; packs:number; pieces:number; price:number; subtotal:number}[];
  history:{id:number; actor:string; status:string; created_at:string}[];
};
type Category = {id:number; parent_id:number|null; name:string; order:number; active:boolean; image:string|null};
type Product = {id:number; name:string; description:string|null; sku:string|null; country:string|null; badge_text:string|null;
  badge_bg_color:string|null; price_per_unit:number; pieces_per_pack:number; min_order_packs:number; in_stock:number|null;
  category_id:number; subcategory_id:number|null; active:boolean; is_new:boolean; images:string[]; updated_at:string};
const statuses:Record<string,string> = {new:'Новая', processing:'В работе', accepted:'Подтверждена', shipped:'Отправлена', completed:'Выполнена', cancelled:'Отменена', rejected:'Отменена'};
const date = (value:string) => new Date(value.endsWith('Z') ? value : value+'Z').toLocaleString('ru-RU');
const write = <T,>(path:string, method:string, body?:unknown) => api<T>('/admin'+path,{method,body:body === undefined ? undefined : JSON.stringify(body)});
const sections = [
  ['orders','Заявки',ClipboardList],['analytics','Аналитика',BarChart3],['products','Товары',Package],
  ['categories','Категории',FolderTree],['import','Импорт',FileSpreadsheet],['content','Сайт',LayoutTemplate],['notifications','Уведомления',Bell],
] as const;

function useQuery<T>(path:string, revision=0) {
  const [data,setData]=useState<T>();
  const [error,setError]=useState('');
  useEffect(()=>{
    const controller = new AbortController();
    setError('');
    api<T>('/admin'+path,{signal:controller.signal}).then(setData).catch(err=>{
      if(!controller.signal.aborted) setError(err.message);
    });
    return ()=>controller.abort();
  },[path,revision]);
  return {data,error};
}

function useEditor() {
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{
    if(!dirty)return;
    const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    const leaveEditor=(event:Event)=>{if(!confirm('Закрыть форму с несохранёнными изменениями?'))event.preventDefault();};
    window.addEventListener('beforeunload',leave);
    window.addEventListener('kurortnik:leave-editor',leaveEditor);
    return ()=>{
      window.removeEventListener('beforeunload',leave);
      window.removeEventListener('kurortnik:leave-editor',leaveEditor);
    };
  },[dirty]);
  return {dirty,mark:()=>setDirty(true),saved:()=>setDirty(false),leave:()=>!dirty||confirm('Закрыть форму с несохранёнными изменениями?')};
}

function useAction() {
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const pending=useRef(false);
  async function run(operation:()=>Promise<unknown>, success='Сохранено') {
    if(pending.current)return;
    pending.current=true;setBusy(true);setMessage('');setError('');
    try {await operation();setMessage(success);}
    catch(err){setError((err as Error).message);}
    finally{pending.current=false;setBusy(false);}
  }
  return {run,busy,feedback:<>{error&&<p role="alert" className="error-text">{error}</p>}{message&&<p role="status">{message}</p>}</>};
}

function Login({onLogin}:{onLogin:(staff:Staff)=>void}) {
  const action=useAction();
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));
    void action.run(async()=>onLogin(await write<Staff>('/login','POST',data)));
  }
  return <main className="admin-login"><a href="/">Курортник</a><h1>Вход для сотрудников</h1><form className="admin-form" onSubmit={submit}>
    <Field name="login" label="Логин" required autoComplete="username"/><Field name="password" label="Пароль" type="password" required autoComplete="current-password"/>
    {action.feedback}<button className="button" disabled={action.busy}>Войти</button>
  </form></main>;
}

function Field({label,...props}:React.ComponentProps<'input'>&{label:string}) {
  return <label>{label}<input {...props}/></label>;
}

function Orders({staff,revision,refresh}:{staff:Staff;revision:number;refresh:()=>void}) {
  const [filter,setFilter]=useState('');
  const [page,setPage]=useState(1);
  const orderMatch=location.pathname.match(/^\/admin\/orders\/(\d+)\/?$/);
  const [id,setId]=useState<number|null>(orderMatch ? Number(orderMatch[1]) : null);
  const result=useQuery<{items:Order[];total:number}>(`/orders?status=${filter}&page=${page}`,revision);
  useEffect(()=>{
    const change=()=>{const match=location.pathname.match(/^\/admin\/orders\/(\d+)\/?$/);setId(match ? Number(match[1]) : null);};
    window.addEventListener('popstate',change);
    return ()=>window.removeEventListener('popstate',change);
  },[]);
  function select(orderId:number|null){history.pushState(null,'',orderId ? `/admin/orders/${orderId}` : '/admin');setId(orderId);}
  if(id)return <OrderDetail key={id} id={id} staff={staff} revision={revision} refresh={refresh} close={()=>select(null)}/>;
  return <><h1>Заявки</h1><label className="admin-inline">Статус<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="">Все</option>{Object.entries(statuses).filter(([key])=>key!=='rejected').map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">Загрузка…</p> : <div className="admin-cards">{result.data.items.length===0&&<p>Заявок нет.</p>}{result.data.items.map(order=><button key={order.id} className="admin-order" onClick={()=>select(order.id)}>
      <strong>№{order.id} · {statuses[order.status]??order.status}</strong><span>{date(order.created_at)}</span><span>{order.name} · {order.phone}</span>
      <span>{order.items.slice(0,2).map(item=>`${item.name} × ${item.packs} уп.`).join(', ')}</span><span>{money(order.total)} · {order.manager??'Свободна'}</span>
    </button>)}</div>}
    <Pager page={page} total={result.data?.total??0} setPage={setPage}/>
  </>;
}

function Pager({page,total,setPage}:{page:number;total:number;setPage:(value:number)=>void}) {
  return total>30 ? <nav className="pagination" aria-label="Страницы"><button disabled={page===1} onClick={()=>setPage(page-1)}>Назад</button><span>{page}</span><button disabled={page*30>=total} onClick={()=>setPage(page+1)}>Далее</button></nav> : null;
}

function OrderDetail({id,staff,revision,refresh,close}:{id:number;staff:Staff;revision:number;refresh:()=>void;close:()=>void}) {
  const result=useQuery<Order>('/orders/'+id,revision);
  const team=useQuery<{id:number;name:string}[]>('/team');
  const action=useAction();
  const order=result.data;
  const update=(method:string,suffix:string,body?:unknown)=>action.run(async()=>{await write('/orders/'+id+suffix,method,body);refresh();});
  return <><button className="button secondary" onClick={close}>Все заявки</button><h1>Заявка №{id}</h1>
    {!order ? <p role={result.error?'alert':'status'}>{result.error||'Загрузка…'}</p> : <>
      <p><strong>{statuses[order.status]??order.status}</strong> · {date(order.created_at)} · {order.manager??'Ответственный не назначен'}</p>
      <div className="admin-panel"><h2>{order.name}</h2><a className="button secondary" href={phoneHref(order.phone)}><Phone size={18}/> {order.phone}</a>
        {order.organization&&<p>{order.organization}</p>}{order.comment&&<p className="long-text">{order.comment}</p>}
        <ul className="admin-items">{order.items.map(item=><li key={item.id}>{item.photo&&<img src={item.photo} alt="" loading="lazy"/>}<span><strong>{item.name}</strong>{item.sku&&' · '+item.sku}<br/>{item.packs} уп. · {item.pieces} шт. · {money(item.price)} за шт.</span><strong>{money(item.subtotal)}</strong></li>)}</ul>
        <p>Сумма заявки <strong>{money(order.total)}</strong></p>
      </div>
      <div className="actions">
        {order.status==='new'&&!order.manager&&<button className="button" disabled={action.busy} onClick={()=>void update('POST','/claim')}>Взять в работу</button>}
        {(staff.role==='admin'||order.manager_id===staff.id)&&<form key={order.status+'-'+order.manager_id} className="admin-inline" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);const value=String(form.get('manager')??'');void update('PUT','/status',{status:form.get('status'),expected_status:order.status,...(value ? {manager_id:Number(value)} : {})});}}>
          <label>Статус<select name="status" defaultValue={order.status==='rejected'?'cancelled':order.status}>{Object.entries(statuses).filter(([key])=>key!=='rejected').map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
          {staff.role==='admin'&&<label>Ответственный<select name="manager" defaultValue={order.manager_id??''}><option value="">Сохранить текущего</option>{team.data?.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}<option value="0">Снять назначение</option></select></label>}
          <button className="button" disabled={action.busy}>Сохранить</button>
        </form>}
        {staff.role==='admin'&&<button className="button secondary" disabled={action.busy} onClick={()=>{if(confirm('Переместить заявку в архив?'))void action.run(async()=>{await write('/orders/'+id,'DELETE');refresh();close();});}}>В архив</button>}
      </div>
      {action.feedback}
      <h2>История статусов</h2>{order.history.length ? <ol>{order.history.map(item=><li key={item.id}>{date(item.created_at)} · {item.actor} · {statuses[item.status]??item.status}</li>)}</ol> : <p>Записей пока нет.</p>}
    </>}
  </>;
}

function CatalogAdmin({categories=false,onProducts}:{categories?:boolean;onProducts:(id:number)=>void}) {
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('');
  const [category,setCategory]=useState(()=>new URLSearchParams(location.search).get('category')??'');
  const [revision,refresh]=useState(0);
  const [edit,setEdit]=useState<Category|Product|'new'|null>(null);
  const [selected,setSelected]=useState<number[]>([]);
  const tree=useQuery<Category[]>('/categories',revision);
  const products=useQuery<{items:Product[];total:number}>(`/products?q=${encodeURIComponent(search)}&filter=${filter}&category=${category}&page=${page}`,revision);
  const action=useAction();
  const editor=useEditor();
  function change(value:typeof edit){if(editor.leave()){editor.saved();setEdit(value);}}
  function save(id:number|undefined, values:unknown){
    void action.run(async()=>{await write((categories?'/categories':'/products')+(id?'/'+id:''),id?'PUT':'POST',values);editor.saved();setEdit(null);refresh(n=>n+1);});
  }
  function remove(id:number){
    if(!confirm(categories?'Удалить категорию?':'Снять товар с продажи?'))return;
    void action.run(async()=>{await write((categories?'/categories':'/products')+'/'+id,'DELETE');refresh(n=>n+1);});
  }
  const items=categories?tree.data:products.data?.items;
  return <><h1>{categories?'Категории':'Товары'}</h1><div className="actions"><button className="button" onClick={()=>change('new')}>{categories?'Добавить категорию':'Добавить товар'}</button></div>
    {action.feedback}{(categories?tree.error:products.error)&&<p role="alert">{categories?tree.error:products.error}</p>}
    {edit ? <div className="admin-panel"><h2>{edit==='new'?'Создание':'Редактирование'}</h2>{categories
      ? <CategoryEditor key={edit==='new'?'new':edit.id} category={edit==='new'?undefined:edit as Category} tree={tree.data??[]} save={save} mark={editor.mark} busy={action.busy} close={()=>change(null)}/>
      : <ProductEditor key={edit==='new'?'new':edit.id} product={edit==='new'?undefined:edit as Product} tree={tree.data??[]} defaultCategory={Number(category)>0?Number(category):tree.data?.find(item=>item.id===Number(category))?.parent_id??undefined} defaultSubcategory={Number(category)<0?-Number(category):undefined} save={save} mark={editor.mark} busy={action.busy} close={()=>change(null)}/>}</div> : <>
      {!categories&&<><div className="admin-inline"><Field value={search} label="Название или артикул" onChange={event=>{setSearch(event.target.value);setPage(1);}}/>
        <label>Фильтр<select value={filter} onChange={event=>{setFilter(event.target.value);setPage(1);}}><option value="">Все</option><option value="new">Новинки</option><option value="hidden">Скрытые</option><option value="out">Нет в наличии</option></select></label>
        <label>Категория<select value={category} onChange={event=>{setCategory(event.target.value);setPage(1);}}><option value="">Все</option>{tree.data?.map(item=><option key={item.id} value={item.id}>{item.parent_id?"— ":""}{item.name}</option>)}</select></label>
      </div>{selected.length>0&&<div className="actions"><span>Выбрано: {selected.length}</span>{[true,false].map(active=><button key={String(active)} className="button secondary" disabled={action.busy} onClick={()=>void action.run(async()=>{await write('/products/bulk','PATCH',{ids:selected,active});setSelected([]);refresh(n=>n+1);})}>{active?'Показать':'Скрыть'}</button>)}</div>}</>}
      <div className="admin-table" role="table" aria-label={categories?'Категории':'Товары'}>
        {items?.map(item=><div key={item.id} role="row" className="admin-row">
          <div role="cell" className="admin-row-name">{'sku' in item ? <label><input type="checkbox" checked={selected.includes(item.id)} onChange={event=>setSelected(previous=>event.target.checked?[...previous,item.id]:previous.filter(id=>id!==item.id))}/>{item.name}</label> : <strong>{item.parent_id ? tree.data?.find(parent=>!parent.parent_id&&parent.id===item.parent_id)?.name+' / ' : null}{item.name}</strong>}</div>
          <div role="cell">{'sku' in item ? <>№{item.id} · {item.sku||'Без артикула'} · {money(item.price_per_unit)} за шт. · {item.in_stock??'Без учёта'} уп.</> : `Порядок ${item.order}`} · {item.active?'Виден':'Скрыт'}</div>
          <div role="cell" className="actions">{'parent_id' in item&&<button onClick={()=>onProducts(item.id)}>Товары</button>}{'sku' in item&&<button onClick={()=>void action.run(async()=>{await write('/products/bulk','PATCH',{ids:[item.id],active:!item.active});refresh(n=>n+1);})}>{item.active?'Скрыть':'Показать'}</button>}
            <button onClick={()=>change(item)}>Редактировать</button>{item.name.toLowerCase()!=='новинки'&&<button onClick={()=>remove(item.id)}>Удалить</button>}</div>
        </div>)}
      </div>
      {!categories&&<Pager page={page} total={products.data?.total??0} setPage={setPage}/>}
    </>}
  </>;
}

function UploadImage({onImage,multiple=false}:{onImage:(url:string)=>void;multiple?:boolean}) {
  const action=useAction();
  return <div><label>Загрузить фото<input type="file" accept="image/jpeg,image/png,image/webp" multiple={multiple} disabled={action.busy} onChange={event=>{
    const files=Array.from(event.target.files??[]);event.target.value='';
    if(files.length)void action.run(async()=>{for(const file of files){const body=new FormData();body.append('file',file);onImage((await api<{url:string}>('/admin/images',{method:'POST',body})).url);}},'Фото загружено');
  }}/></label>{action.feedback}</div>;
}

function CategoryEditor({category,tree,save,mark,busy,close}:{category?:Category;tree:Category[];save:(id:number|undefined,body:unknown)=>void;mark:()=>void;busy:boolean;close:()=>void}) {
  const [image,setImage]=useState(category?.image??'');
  return <form className="admin-form" onChange={mark} onSubmit={event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);
    save(category?.id,{name:form.get('name'),order:Number(form.get('order')),active:form.has('active'),image:image||null,parent_id:Number(form.get('parent_id'))||null});
  }}>
    <Field name="name" label="Название" required maxLength={255} defaultValue={category?.name}/>
    <label>Родительская категория<select name="parent_id" defaultValue={category?.parent_id??''} disabled={!!category}><option value="">Верхний уровень</option>{tree.filter(item=>!item.parent_id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {category?.parent_id&&<input type="hidden" name="parent_id" value={category.parent_id}/>}
    <Field name="order" label="Порядок" type="number" required defaultValue={category?.order??0}/><label className="admin-check"><input name="active" type="checkbox" defaultChecked={category?.active??true}/> Показывать в каталоге</label>
    <Field label="Адрес изображения" value={image} onChange={event=>setImage(event.target.value)}/>
    <UploadImage onImage={url=>{setImage(url);mark();}}/>{image&&<div className="admin-images"><img src={image} alt="Текущее фото"/><button type="button" onClick={()=>{setImage('');mark();}}>Убрать фото</button></div>}
    <EditorButtons busy={busy} close={close}/>
  </form>;
}

function ProductEditor({product,tree,defaultCategory,defaultSubcategory,save,mark,busy,close}:{product?:Product;tree:Category[];defaultCategory?:number;defaultSubcategory?:number;save:(id:number|undefined,body:unknown)=>void;mark:()=>void;busy:boolean;close:()=>void}) {
  const [category,setCategory]=useState(product?.category_id??defaultCategory??0);
  const [subcategory,setSubcategory]=useState(product?.subcategory_id??defaultSubcategory??0);
  const [images,setImages]=useState(product?.images??[]);
  const [url,setUrl]=useState('');
  const add=(image:string)=>{setImages(previous=>previous.includes(image)?previous:[...previous,image].slice(0,12));mark();};
  return <form className="admin-form" onChange={mark} onSubmit={event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);const fields=Object.fromEntries(form);
    save(product?.id,{...fields,category_id:category,subcategory_id:subcategory||null,price_per_unit:Number(fields.price_per_unit),pieces_per_pack:Number(fields.pieces_per_pack),min_order_packs:Number(fields.min_order_packs),in_stock:fields.in_stock===''?null:Number(fields.in_stock),expected_updated_at:product?.updated_at,active:form.has('active'),is_new:form.has('is_new'),images});
  }}>
    <Field name="name" label="Название" required maxLength={500} defaultValue={product?.name}/>
    <div className="admin-form-two">
      <label>Категория<select value={category||''} required onChange={event=>{setCategory(Number(event.target.value));setSubcategory(0);}}><option value="">Выберите категорию</option>{tree.filter(item=>!item.parent_id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Подкатегория<select value={subcategory} onChange={event=>setSubcategory(Number(event.target.value))}><option value="0">Без подкатегории</option>{tree.filter(item=>item.parent_id===category).map(item=><option key={item.id} value={-item.id}>{item.name}</option>)}</select></label>
      <Field name="sku" label="Артикул" maxLength={100} defaultValue={product?.sku??''}/><Field name="country" label="Страна" maxLength={100} defaultValue={product?.country??''}/>
      <Field name="price_per_unit" label="Цена за штуку, ₽" type="number" step=".01" min="0" required defaultValue={product?.price_per_unit}/>
      <Field name="pieces_per_pack" label="Штук в упаковке" type="number" min="1" required defaultValue={product?.pieces_per_pack??1}/>
      <Field name="min_order_packs" label="Минимум упаковок" type="number" min="1" required defaultValue={product?.min_order_packs??1}/>
      <Field name="in_stock" label="Остаток, упаковок" type="number" min="0" placeholder="Пусто — без учёта" defaultValue={product?.in_stock??''}/>
      <Field name="badge_text" label="Текст метки" maxLength={50} defaultValue={product?.badge_text??''}/>
      <Field name="badge_bg_color" label="Цвет метки" maxLength={20} placeholder="#205e77" defaultValue={product?.badge_bg_color??''}/>
    </div>
    <label>Описание<textarea name="description" maxLength={12000} defaultValue={product?.description??''}/></label>
    <label className="admin-check"><input name="active" type="checkbox" defaultChecked={product?.active??true}/> Показывать в каталоге</label>
    <label className="admin-check"><input name="is_new" type="checkbox" defaultChecked={product?.is_new??false}/> Новинка</label>
    <UploadImage onImage={add} multiple/><div className="admin-inline"><Field label="Адрес фотографии" value={url} onChange={event=>setUrl(event.target.value)}/><button type="button" disabled={!url} onClick={()=>{add(url.trim());setUrl('');}}>Добавить по адресу</button></div>
    <div className="admin-images">{images.map((src,index)=><div key={src}><img src={src} alt={`Фото ${index+1}`}/>{index===0 ? <span>Главное</span> : <button type="button" onClick={()=>{setImages(previous=>[src,...previous.filter(image=>image!==src)]);mark();}}>Сделать главным</button>}<button type="button" onClick={()=>{setImages(previous=>previous.filter(image=>image!==src));mark();}}>Убрать</button></div>)}</div>
    <EditorButtons busy={busy} close={close}/>
  </form>;
}

function EditorButtons({busy,close}:{busy:boolean;close:()=>void}) {
  return <div className="actions"><button className="button" disabled={busy}>Сохранить</button><button type="button" className="button secondary" onClick={close}>Закрыть</button></div>;
}

function Analytics({revision}:{revision:number}) {
  const {data,error}=useQuery<{total:number;count:number;average:number;customers:number;products:number;categories:number;new:number;completed:number;confirmed_sum:number;days:{date:string;total:number;count:number}[];top:{name:string;packs:number}[]}>('/analytics',revision);
  if(!data)return <p role={error?'alert':'status'}>{error||'Загрузка…'}</p>;
  const max=Math.max(1,...data.days.map(day=>day.total));
  const maxCount=Math.max(1,...data.days.map(day=>day.count));
  return <><h1>Аналитика</h1><div className="admin-cards">{[['Сумма заявок',money(data.total)],['Заявки',data.count],['Средняя сумма',money(data.average)],['Покупатели',data.customers],['Товары',data.products],['Категории',data.categories],['Новые заявки',data.new],['Выполненные',data.completed],['Подтверждено и выполнено',money(data.confirmed_sum)]].map(([title,value])=><div className="admin-panel" key={title}><p>{title}</p><strong>{value}</strong></div>)}</div>
    <h2>Заявки за 30 дней</h2><div className="admin-chart">{data.days.map(day=><div key={day.date}><span>{day.date}</span><meter aria-label="Сумма заявок" value={day.total} max={max}/><meter aria-label="Число заявок" value={day.count} max={maxCount}/><span>{money(day.total)} · {day.count} заявок</span></div>)}</div>
    <h2>Топ товаров по упаковкам</h2><ol>{data.top.map(row=><li key={row.name}>{row.name} · {row.packs} уп.</li>)}</ol></>;
}

function Import() {
  const [preview,setPreview]=useState<{id:string;added:number;updated:number;errors:string[];warnings:string[]}>();
  const action=useAction();
  return <><h1>Импорт товаров</h1><a href="/api/v1/admin/import/template" download>Скачать шаблон Excel</a><form className="admin-form" onSubmit={event=>{
    event.preventDefault();const body=new FormData(event.currentTarget);setPreview(undefined);
    void action.run(async()=>setPreview(await api('/admin/import',{method:'POST',body})),'Предпросмотр готов');
  }}><label>Таблица товаров<input name="file" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv" required/></label><button className="button" disabled={action.busy}>Проверить файл</button></form>
    {action.feedback}{preview&&<div className="admin-panel"><p>Новых: {preview.added} · Обновлений: {preview.updated}</p>{preview.errors.length>0&&<><h2>Ошибки</h2><ul>{preview.errors.map((error,index)=><li key={index}>{error}</li>)}</ul></>}
      {preview.warnings.length>0&&<><h2>Предупреждения</h2><ul>{preview.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></>}
      <button className="button" disabled={action.busy||preview.errors.length>0||!(preview.added+preview.updated)} onClick={()=>{if(confirm('Применить изменения из таблицы?'))void action.run(async()=>{await write('/import/'+preview.id,'POST');setPreview(undefined);},'Импорт применён');}}>Применить импорт</button>
    </div>}</>;
}

function ContentAdmin() {
  const {data,error}=useQuery<Content>('/content');
  return <><h1>Содержимое сайта</h1>{data ? <ContentEditor content={data}/> : <p role={error?'alert':'status'}>{error||'Загрузка…'}</p>}</>;
}

function ContentEditor({content}:{content:Content}) {
  const editor=useEditor();
  const action=useAction();
  const [image,setImage]=useState(content.banner_image);
  const [pages,setPages]=useState(Object.entries(content.pages).map(([slug,page])=>({slug,...page})));
  const setPage=(index:number,field:'slug'|'title'|'body',value:string)=>setPages(previous=>previous.map((p,i)=>i===index?{...p,[field]:value}:p));
  return <form className="admin-form" onChange={editor.mark} onSubmit={event=>{
    event.preventDefault();const form=Object.fromEntries(new FormData(event.currentTarget));
    const ids=(value:FormDataEntryValue)=>String(value).split(/[,\s]+/).filter(Boolean).map(Number);
    void action.run(async()=>{if(new Set(pages.map(page=>page.slug)).size!==pages.length)throw new Error('Адреса информационных страниц должны различаться.');
      await write('/content','PUT',{...form,banner_image:image,steps:String(form.steps).split('\n').map(line=>line.trim()).filter(Boolean),featured_ids:ids(form.featured_ids),offer_ids:ids(form.offer_ids),pages:Object.fromEntries(pages.map(page=>[page.slug,{title:page.title,body:page.body}]))});editor.saved();
    });
  }}>
    {([['title','SEO-заголовок'],['description','SEO-описание'],['banner_title','Заголовок баннера'],['banner_text','Текст баннера'],['phone','Телефон'],['email','Электронная почта'],['address','Адрес']] as const).map(([name,label])=><Field key={name} name={name} label={label} defaultValue={content[name]}/>)}
    <Field label="Изображение баннера" value={image} onChange={event=>setImage(event.target.value)}/><UploadImage onImage={url=>{setImage(url);editor.mark();}}/>
    <label>Условия заказа<textarea name="conditions" defaultValue={content.conditions}/></label><label>Доставка<textarea name="delivery" defaultValue={content.delivery}/></label>
    <label>Порядок заказа, один шаг на строку<textarea name="steps" defaultValue={content.steps.join('\n')}/></label>
    <Field name="featured_ids" label="Номера популярных товаров через запятую" defaultValue={content.featured_ids.join(', ')}/><Field name="offer_ids" label="Номера товаров со спецпредложениями через запятую" defaultValue={content.offer_ids.join(', ')}/>
    <h2>Информационные страницы</h2>{pages.map((page,index)=><fieldset key={index}><Field label="Адрес страницы" required pattern="[a-z0-9-]+" value={page.slug} onChange={event=>setPage(index,'slug',event.target.value)}/><Field label="Заголовок страницы" required value={page.title} onChange={event=>setPage(index,'title',event.target.value)}/><label>Текст страницы<textarea value={page.body} onChange={event=>setPage(index,'body',event.target.value)}/></label><button type="button" onClick={()=>{if(confirm('Удалить информационную страницу?')){setPages(previous=>previous.filter((_,i)=>i!==index));editor.mark();}}}>Удалить страницу</button></fieldset>)}
    <button type="button" className="button secondary" onClick={()=>{setPages(previous=>[...previous,{slug:'',title:'',body:''}]);editor.mark();}}>Добавить страницу</button>
    {action.feedback}<button className="button" disabled={action.busy}>Сохранить содержимое</button>
  </form>;
}

function Notifications({staff}:{staff:Staff}) {
  const [revision,refresh]=useState(0);
  const devices=useQuery<{id:number;label:string;created_at:string}[]>('/push',revision);
  const deliveries=useQuery<{id:number;order_id:number;channel:string;status:string;attempts:number;last_error:string|null}[]>(staff.role==='admin'?'/deliveries':'/my-deliveries',revision);
  const action=useAction();
  async function subscribe(){
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Web Push недоступен в этом браузере.');
    if(await Notification.requestPermission()!=='granted')throw new Error('Разрешите уведомления в настройках браузера.');
    const {public_key}=await api<{public_key:string}>('/admin/push/key');
    const worker=await navigator.serviceWorker.register('/admin/push-sw.js',{scope:'/admin/'});
    if (!worker.active) {
      const installing=worker.installing??worker.waiting;
      if(!installing)throw new Error('Не удалось запустить обработчик уведомлений.');
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Обработчик уведомлений долго запускается.')),12000);
        const state=()=>{
          if(installing.state==='activated'){clearTimeout(timer);resolve();}
          if(installing.state==='redundant'){clearTimeout(timer);reject(new Error('Обработчик уведомлений недоступен.'));}
        };
        installing.addEventListener('statechange',state);
        state();
      });
    }
    const ready=worker;
    const bytes=Uint8Array.from(atob(public_key.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
    const sub=await ready.pushManager.getSubscription()??await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
    await write('/push','POST',{...sub.toJSON(),label:navigator.platform||'Браузер'});refresh(n=>n+1);
  }
  return <><h1>Уведомления</h1><button className="button" disabled={action.busy} onClick={()=>void action.run(subscribe,'Уведомления включены')}>Включить на этом устройстве</button>
    {action.feedback}<h2>Устройства</h2>{devices.error&&<p role="alert">{devices.error}</p>}<ul>{devices.data?.map(device=><li key={device.id}>{device.label} · {date(device.created_at)} <button disabled={action.busy} onClick={()=>void action.run(async()=>{await write('/push/'+device.id,'DELETE');refresh(n=>n+1);})}>Отключить</button></li>)}</ul>
    <h2>Журнал доставки</h2><button className="button secondary" onClick={()=>refresh(n=>n+1)}>Обновить журнал</button>{deliveries.error&&<p role="alert">{deliveries.error}</p>}<ul>{deliveries.data?.map(item=><li key={item.id}>№{item.order_id} · {item.channel==='email'?'Почта':'Web Push'} · {({pending:'ожидает',sending:'отправляется',sent:'отправлено',failed:'ошибка',invalid:'подписка недействительна'} as Record<string,string>)[item.status]??item.status} · попыток {item.attempts}{item.last_error&&' · '+item.last_error}
      {staff.role==='admin'&&item.status==='failed'&&<button onClick={()=>void action.run(async()=>{await write('/deliveries/'+item.id+'/retry','POST');refresh(n=>n+1);})}>Повторить</button>}</li>)}</ul>
  </>;
}

export default function Admin() {
  const [staff,setStaff]=useState<Staff|null>();
  const [section,select]=useState<string>(()=>new URLSearchParams(location.search).get('section')??'orders');
  const [revision,setRevision]=useState(0);
  const [count,setCount]=useState(0);
  const [online,setOnline]=useState(false);
  const action=useAction();
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  const accept=(session:Staff)=>{setCsrf(session.csrf);setStaff(session);};
  useEffect(()=>{
    document.title='Админ-панель — Курортник';
    const controller=new AbortController();
    api<Staff>('/admin/session',{signal:controller.signal}).then(session=>{
      if(!controller.signal.aborted)accept(session);
    }).catch(()=>{if(!controller.signal.aborted)setStaff(null);});
    return ()=>controller.abort();
  },[]);
  useEffect(()=>{
    if(!staff)return;
    const events=new EventSource('/api/v1/admin/events');
    events.onopen=()=>setOnline(true);
    events.onerror=()=>{setOnline(false);void api('/admin/session').catch(()=>{setCsrf('');setStaff(null);});};
    events.onmessage=event=>{setCount((JSON.parse(event.data) as {new_count:number}).new_count);refresh();};
    return ()=>events.close();
  },[staff,refresh]);
  if(staff===undefined)return <p role="status">Проверка сеанса…</p>;
  if(!staff)return <Login onLogin={accept}/>;
  const available=sections.filter(([name])=>staff.role==='admin'||name==='orders'||name==='notifications');
  const screen=available.some(([name])=>name===section)?section:'orders';
  function navigate(target:string,category?:number) {
    const query=target==='orders'?'':`?section=${target}${category?'&category='+category:''}`;
    // A document navigation lets beforeunload protect any active editor.
    if(target===screen&&location.pathname==='/admin'&&location.search===query){select(target);return;}
    location.assign('/admin'+query);
  }
  const panels:Record<string,ReactNode>={
    orders:<Orders staff={staff} revision={revision} refresh={refresh}/>,
    products:<CatalogAdmin onProducts={id=>navigate('products',id)}/>,
    categories:<CatalogAdmin categories onProducts={id=>navigate('products',id)}/>,
    analytics:<Analytics revision={revision}/>,import:<Import/>,content:<ContentAdmin/>,notifications:<Notifications staff={staff}/>,
  };
  return <div className="admin-shell"><aside className="admin-sidebar"><a href="/" className="admin-brand">Курортник</a><p>{staff.name}</p>
    <nav aria-label="Разделы админки">{available.map(([key,label,Icon])=><button key={key} aria-current={screen===key?'page':undefined} onClick={()=>navigate(key)}><Icon size={20}/>{label}{key==='orders'&&count>0&&<strong>{count}</strong>}</button>)}</nav>
    <button className="button secondary" disabled={action.busy} onClick={()=>{if(window.dispatchEvent(new Event('kurortnik:leave-editor',{cancelable:true})))void action.run(async()=>{await write('/logout','POST');setCsrf('');setStaff(null);});}}><LogOut size={18}/> Выйти</button>
    {action.feedback}<p role="status">{online?'Связь с сервером':'Подключение к обновлениям…'}</p>
  </aside><main className="admin-main">{panels[screen]}</main></div>;
}
