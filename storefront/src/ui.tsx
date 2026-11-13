import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowRight,Minus,Plus,ShoppingBag,Check,X,ChevronRight} from 'lucide-react';
import {money,unit,type Product} from './data';
import {useCart} from './cart';
export function Photo({cell,alt,className='',style}:{cell:number;alt:string;className?:string;style?:CSSProperties}){return <div role="img" aria-label={alt} className={`product-photo ${className}`} style={{backgroundPosition:`${cell%3*50}% ${Math.floor(cell/3)*50}%`,...style}}/>;}
export function Quantity({value,min,max,onChange,label='Количество упаковок'}:{value:number;min:number;max:number;onChange:(n:number)=>void;label?:string}){
 const[draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);
 function commit(){const n=Number(draft);const clamped=Math.min(max,Math.max(min,Number.isFinite(n)?Math.floor(n):min));onChange(clamped);setDraft(String(clamped));}
 return <div className="quantity"><button type="button" aria-label={`Уменьшить: ${label}`} disabled={value<=min} onClick={()=>onChange(value-1)}><Minus size={16}/></button><input aria-label={label} type="number" inputMode="numeric" min={min} max={max} step="1" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();e.currentTarget.blur();}}}/><button type="button" aria-label={`Увеличить: ${label}`} disabled={value>=max} onClick={()=>onChange(value+1)}><Plus size={16}/></button></div>;
}
export function ProductCard({p,list=false}:{p:Product;list?:boolean}){
 const[n,setN]=useState(p.minimum);const{add,lines}=useCart();const inCart=lines.some(l=>l.id===p.id);
 return <article className={`product-card ${list?'product-card--list':''}`}>
  <a className="product-card__image" href={`#/product/${p.id}`}><Photo cell={p.photo} alt={p.name}/>{p.isNew&&<span className="tag">Новинка</span>}{!p.available&&<span className="tag tag--sand">Нет в демокаталоге</span>}</a>
  <div className="product-card__body"><div className="product-card__meta"><span>{p.category}</span><span>{p.sku}</span></div><h3><a href={`#/product/${p.id}`}>{p.name}</a></h3>
  <div className="product-card__price"><strong>{money(p.price)}</strong><span> / {unit(p)==='пар'?'пара':'шт.'}</span></div><p className="pack-info">{p.pack} {unit(p)} в упаковке · от {p.minimum} уп.</p><p className="pack-price">{money(p.price*p.pack)} <span>/ упаковка</span></p>
  <div className="product-card__buy"><Quantity value={n} min={p.minimum} max={Math.max(p.minimum,p.available)} onChange={setN} label={`Упаковок товара ${p.name}`}/><button className="add-btn" disabled={!p.available} onClick={()=>add(p,n)} aria-label={`Добавить ${n} уп. товара ${p.name} в заказ`}>{inCart?<Check size={18}/>:<Plus size={18}/>}<span>{inCart?'Ещё в заказ':'В заказ'}</span></button></div><span className="card-total">{n} уп. · {n*p.pack} {unit(p)} · {money(n*p.price*p.pack)}</span>
  </div></article>;
}
export function Heading({eyebrow,title,text,children}:{eyebrow?:string;title:string;text?:string;children?:React.ReactNode}){return <div className="section-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2>{text&&<p className="section-description">{text}</p>}</div>{children}</div>;}
export function Breadcrumb({name,parent}:{name:string;parent?:string}){return <nav className="breadcrumb" aria-label="Путь по сайту"><a href="#/">Главная</a><ChevronRight size={14}/>{parent&&<><a href="#/catalog">{parent}</a><ChevronRight size={14}/></>}<span aria-current="page">{name}</span></nav>;}
export function Empty({title,text}:{title:string;text:string}){return <div className="empty"><ShoppingBag size={38} strokeWidth={1}/><h2>{title}</h2><p>{text}</p><a href="#/catalog" className="button">Открыть каталог <ArrowRight size={18}/></a></div>;}
export function ConfirmDialog({open,onClose,onConfirm}:{open:boolean;onClose:()=>void;onConfirm:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{if(open)ref.current?.showModal();else ref.current?.close();},[open]);return <dialog ref={ref} className="confirm-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><button className="dialog-x icon-button" aria-label="Закрыть" onClick={onClose}><X/></button><h2>Очистить заказ?</h2><p>Все добавленные позиции будут удалены из корзины.</p><div className="actions"><button className="button secondary" onClick={onClose}>Оставить товары</button><button className="button" onClick={()=>{onConfirm();onClose();}}>Да, очистить</button></div></dialog>;}
