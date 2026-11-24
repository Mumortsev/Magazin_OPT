import {useEffect,useRef,useState,type FocusEvent,type ReactNode} from 'react';
import {ArrowRight,Minus,Plus,ShoppingBag,Check,X,ChevronRight,Package} from 'lucide-react';
import {money,canOrder,demoMode,packLimit,storefrontImage,type Product} from './data';
import {useCart} from './cart';
import {collections,type Collection} from './collections';

export function CarouselDots({label,slides,active,onSelect}:{label:string;slides:string[];active:number;onSelect:(index:number)=>void}) {
  return <div className="carousel-dots" role="group" aria-label={label}>
    {slides.map((slide,index)=><button key={slide} type="button" aria-label={slide}
      aria-current={index===active?'true':undefined} disabled={slides.length===1} onClick={()=>onSelect(index)}/>)}
  </div>;
}
export function Photo({src,alt,eager=false}:{src?:string|null;alt:string;eager?:boolean}) {
 const detail = demoMode && src?.endsWith('#detail');
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[src]);
 return <div className={detail ? "product-photo product-photo--detail" : "product-photo"}>{src&&!failed
   ? <img src={storefrontImage(src)} alt={alt} loading={eager?'eager':'lazy'} decoding="async" onError={()=>setFailed(true)}/>
   : <span className="photo-fallback" role="img" aria-label="Фото отсутствует"><ShoppingBag size={36}/></span>}</div>;
}
function ProductImages({product,collection}: {product:Product;collection?:Collection}) {
  const {id, images, name, badge, isNew} = product;
  const href = `#/product/${id}`;
  const labelClass = product.referenceUrl ? 'tag tag--artwork' : 'tag';
  const label = collection ? <span className={`${labelClass} collection-tag collection-tag--${collection}`}>{collections[collection].title}</span>
    : (isNew || badge) && <span className={labelClass}>{badge || 'Новинка'}</span>;
  if (!images.length) {
    return <a className="product-card__image" href={href}>
      <Photo src={images[0]} alt={name}/>{label}
    </a>;
  }
  return <ProductCarousel images={images} name={name} href={href}>{label}</ProductCarousel>;
}

const AUTO_ADVANCE_MS = 4500;

export function ProductCarousel({images, name, href, children}: {images:string[]; name:string; href?:string; children?:ReactNode}) {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReducedMotion(motion.matches);
    motion.addEventListener('change', changed);
    const visibilityChanged = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibilityChanged);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= .55), {threshold:.55});
    if (href && track.current) observer.observe(track.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', changed);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [href]);

  useEffect(() => {
    if (!href || images.length < 2 || !visible || !pageVisible || paused || focused || hovered || reducedMotion) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      const next = (position + 1) % images.length;
      const element = track.current;
      element?.scrollTo({left:next * element.clientWidth, behavior:next ? 'smooth' : 'instant'});
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [href,visible,pageVisible,paused,focused,hovered,reducedMotion,position,images.length]);

  function choose(index:number) {
    setPaused(true);
    const element = track.current;
    element?.scrollTo({left:index * element.clientWidth, behavior:reducedMotion ? 'instant' : 'smooth'});
  }

  function blur(event:FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
  }

  if (!images.length) return <Photo alt={name}/>;

  return <div className={href?'product-card__image product-carousel':'product-carousel'} role="group" aria-label={`Фото товара «${name}»`}
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onFocus={()=>setFocused(true)} onBlur={blur}>
    <div className="product-carousel-track" ref={track}
      onScroll={event=>{
        const {scrollLeft,clientWidth}=event.currentTarget;
        if (clientWidth) setPosition(Math.min(images.length-1,Math.max(0,Math.round(scrollLeft/clientWidth))));
      }} onPointerDown={()=>setPaused(true)}>
      {images.map((src,index)=>href
        ? <a key={index} className="product-carousel-slide" href={href} tabIndex={index===position?0:-1}
            aria-hidden={index!==position} aria-label={`Открыть товар «${name}»`}><Photo src={src} alt={name}/></a>
        : <div key={index} className="product-carousel-slide" aria-hidden={index!==position}>
            <Photo src={src} alt={name} eager={index===0}/>
          </div>)}
    </div>
    {children}
    <CarouselDots label="Выбрать фото" slides={images.map((_,index)=>`Показать фото ${index+1}`)} active={position} onSelect={choose}/>
  </div>;
}

export function Quantity({value,min,max,onChange,label='Количество упаковок'}:{value:number;min:number;max:number;onChange:(n:number)=>void;label?:string}){
 const[draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);
 function commit(){const n=Number(draft);const clamped=Math.min(max,Math.max(min,Number.isFinite(n)?Math.floor(n):min));onChange(clamped);setDraft(String(clamped));}
 return <div className="quantity"><button type="button" aria-label={`Уменьшить: ${label}`} disabled={value<=min} onClick={()=>onChange(value-1)}><Minus size={16}/></button><input aria-label={label} type="number" inputMode="numeric" min={min} max={max} step="1" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();commit();e.currentTarget.blur();}}}/><button type="button" aria-label={`Увеличить: ${label}`} disabled={value>=max} onClick={()=>onChange(value+1)}><Plus size={16}/></button></div>;
}
export function ProductCard({p,list=false,detail=false,collection}:{p:Product;list?:boolean;detail?:boolean;collection?:Collection}){
 const[n,setN]=useState(p.minimum);const{add,lines}=useCart();const inCart=lines.some(l=>l.id===p.id);
 return <article className={`product-card ${list?'product-card--list':''}`}>
  {!detail&&<ProductImages product={p} collection={collection}/>}
  {collection&&<div className={`collection-card-facts collection-card-facts--${collection}`}>
    <span><Package size={16} aria-hidden="true"/> {p.pack} шт. в упаковке</span><span>От {p.minimum} уп.</span>
  </div>}
  <div className="product-card__body"><div className="product-card__meta"><span>{p.category}</span><span>{p.sku}</span></div>{!detail&&<h3><a href={`#/product/${p.id}`}>{p.name}</a></h3>}<p className={`availability ${canOrder(p)?'':'unavailable'}`}>{canOrder(p)?'В наличии':'Нет в наличии'}</p>
  {p.description&&<p className={detail?'long-text':'card-description'}>{p.description}</p>}<div className="product-card__price"><strong>{money(p.price)}</strong><span> / шт.</span></div>{!collection&&<p className="pack-info">{p.pack} шт. в упаковке · от {p.minimum} уп.</p>}<p className="pack-price">{money(p.price*p.pack)} <span>/ упаковка</span></p>
  <div className="product-card__buy"><Quantity value={n} min={p.minimum} max={Math.max(p.minimum,packLimit(p))} onChange={setN} label={`Упаковок товара ${p.name}`}/><button className="add-btn" disabled={!canOrder(p)} onClick={()=>add(p,n)} aria-label={`Добавить ${n} уп. товара ${p.name} в заказ`}>{inCart?<Check size={18}/>:<Plus size={18}/>}<span>{inCart?'Ещё в заказ':'В заказ'}</span></button></div><span className="card-total">{n} уп. · {n*p.pack} шт. · {money(n*p.price*p.pack)}</span>
  </div></article>;
}
export function Heading({eyebrow,title,text,children}:{eyebrow?:string;title:string;text?:string;children?:ReactNode}){return <div className="section-heading"><div>{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2>{text&&<p className="section-description">{text}</p>}</div>{children}</div>;}
export function Breadcrumb({name,parent}:{name:string;parent?:string}){return <nav className="breadcrumb" aria-label="Путь по сайту"><a href="#/">Главная</a><ChevronRight size={14}/>{parent&&<><a href="#/catalog">{parent}</a><ChevronRight size={14}/></>}<span aria-current="page">{name}</span></nav>;}
export function Empty({title,text}:{title:string;text:string}){return <div className="empty"><ShoppingBag size={38} strokeWidth={1}/><h2>{title}</h2><p>{text}</p><a href="#/catalog" className="button">Открыть каталог <ArrowRight size={18}/></a></div>;}
export function ConfirmDialog({open,onClose,onConfirm}:{open:boolean;onClose:()=>void;onConfirm:()=>void}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{if(open)ref.current?.showModal();else ref.current?.close();},[open]);return <dialog ref={ref} className="confirm-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><button className="dialog-x icon-button" aria-label="Закрыть" onClick={onClose}><X/></button><h2>Очистить заказ?</h2><p>Все добавленные позиции будут удалены из корзины.</p><div className="actions"><button className="button secondary" onClick={onClose}>Оставить товары</button><button className="button" onClick={()=>{onConfirm();onClose();}}>Да, очистить</button></div></dialog>;}
