import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {productMap,type Product} from './data';
export type CartLine={id:string;packs:number};
const key='kurortnik-cart-v1';
function parse(value:string|null):CartLine[]{try{const data=JSON.parse(value||'[]');if(!Array.isArray(data))return [];const seen=new Set<string>();return data.flatMap((line:unknown)=>{if(!line||typeof line!=='object')return [];const x=line as Partial<CartLine>;const p=typeof x.id==='string'?productMap.get(x.id):undefined;if(!p||seen.has(p.id)||!p.available||typeof x.packs!=='number'||!Number.isFinite(x.packs))return [];seen.add(p.id);return [{id:p.id,packs:Math.max(p.minimum,Math.min(p.available,Math.floor(x.packs)))}];});}catch{return [];}}
function read(){try{return parse(localStorage.getItem(key));}catch{return [];}}
interface CartValue{lines:CartLine[];add:(p:Product,n:number)=>void;setPacks:(id:string,n:number)=>void;remove:(id:string)=>void;clear:()=>void;notice:string;announce:(text:string)=>void}
const Context=createContext<CartValue|null>(null);
export function CartProvider({children}:{children:ReactNode}){
 const[lines,setLines]=useState<CartLine[]>(read),[notice,announce]=useState('');
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(lines));}catch{announce('Браузер не разрешает сохранить корзину. Скачайте заявку перед закрытием.');}},[lines]);
 useEffect(()=>{function changed(e:StorageEvent){if(e.key===key)setLines(parse(e.newValue));}window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>announce(''),4500);return()=>clearTimeout(t);},[notice]);
 const setPacks=(id:string,n:number)=>{const p=productMap.get(id);if(!p||!Number.isFinite(n))return;setLines(prev=>prev.map(l=>l.id===id?{...l,packs:Math.max(p.minimum,Math.min(p.available,Math.floor(n)))}:l));};
 const add=(p:Product,n:number)=>{if(!p.available)return;setLines(prev=>{const old=prev.find(l=>l.id===p.id);const packs=Math.min(p.available,Math.max(p.minimum,Math.floor(n))+(old?.packs||0));return old?prev.map(l=>l.id===p.id?{...l,packs}:l):[...prev,{id:p.id,packs}];});announce(`«${p.name}» — добавлено в заказ`);};
 return <Context.Provider value={{lines,add,setPacks,remove:id=>setLines(prev=>prev.filter(l=>l.id!==id)),clear:()=>setLines([]),notice,announce}}>{children}</Context.Provider>;
}
export function useCart(){const ctx=useContext(Context);if(!ctx)throw Error('CartProvider missing');return ctx;}
