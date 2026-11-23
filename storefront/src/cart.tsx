import {createContext, useContext, useEffect, useState, type ReactNode} from 'react';
import {canOrder, packLimit, type Product} from './data';

export type CartLine = { id: number; packs: number };
const key = 'kurortnik-cart-v2';

function parse(value: string | null): CartLine[] {
  try {
    const lines: CartLine[] = JSON.parse(value ?? '[]');
    return lines.filter((line, index) => Number.isSafeInteger(line?.id) && line.id > 0 &&
      Number.isSafeInteger(line.packs) && line.packs > 0 && line.packs <= 100000 &&
      lines.findIndex(other => other?.id === line.id) === index).slice(0, 100);
  } catch { return []; }
}

interface CartValue {
  lines: CartLine[];
  add: (p: Product, n: number) => void;
  setPacks: (id: number, n: number) => void;
  remove: (id: number) => void;
  clear: () => void;
  notice: string;
}

const Context = createContext<CartValue | null>(null);

export function CartProvider({children}: {children: ReactNode}) {
  const [lines, setLines] = useState(() => {
    try { return parse(localStorage.getItem(key)); } catch { return []; }
  });
  const [notice, announce] = useState('');
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(lines)); }
    catch { announce('Корзина доступна до закрытия этой страницы.'); }
  }, [lines]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => announce(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  function add(product: Product, quantity: number) {
    if (!canOrder(product)) return;
    const previous = lines.find(line => line.id === product.id);
    if (!previous && lines.length >= 100) {
      announce('В одну заявку можно добавить до 100 товаров.');
      return;
    }
    const packs = Math.min(packLimit(product), Math.max(product.minimum, quantity) + (previous?.packs ?? 0));
    setLines(previous ? lines.map(line => line.id === product.id ? {...line, packs} : line) : [...lines, {id: product.id, packs}]);
    announce(`«${product.name}» — ${packs} уп. в корзине`);
  }

  return <Context.Provider value={{
    lines, add, notice,
    setPacks: (id, packs) => setLines(previous => previous.map(line => line.id === id ? {...line, packs} : line)),
    remove: id => setLines(previous => previous.filter(line => line.id !== id)),
    clear: () => setLines([]),
  }}>{children}</Context.Provider>;
}

export function useCart() {
  const cart = useContext(Context);
  if (!cart) throw new Error('CartProvider missing');
  return cart;
}
