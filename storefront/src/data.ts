export interface Category {
  id: number;
  name: string;
  image: string | null;
  subcategories: Category[];
}

export interface Product {
  id: number;
  name: string;
  description: string | null;
  category_id: number;
  subcategory_id: number | null;
  category: string;
  sku: string | null;
  country: string | null;
  price: number;
  pack: number;
  minimum: number;
  available: number | null;
  isNew: boolean;
  images: string[];
  badge: string | null;
}

export interface Content {
  title: string;
  description: string;
  banner_title: string;
  banner_text: string;
  banner_image: string;
  conditions: string;
  delivery: string;
  phone: string;
  email: string;
  address: string;
  steps: string[];
  featured_ids: number[];
  offer_ids: number[];
  pages: Record<string, { title: string; body: string }>;
}

export const money = (amount: number) =>
  new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(amount);

export const canOrder = (product: Product) => product.available === null || product.available >= product.minimum;
export const packLimit = (product: Product) => Math.min(product.available ?? 100000, 100000);
export const phoneHref = (phone: string) => 'tel:' + phone.replace(/[^+\d]/g, '');
let csrf = '';

export function setCsrf(value: string) { csrf = value; }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (csrf && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch('/api/v1' + path, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = data.detail;
    throw new Error(typeof detail === 'string' ? detail : `Запрос не выполнен (HTTP ${response.status})`);
  }
  return response.json();
}
