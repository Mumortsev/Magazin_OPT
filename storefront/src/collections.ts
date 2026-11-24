export const collections = {
  sale: {title: 'Распродажа', text: 'Специальные предложения на товары для пляжа и отдыха.', action: 'Смотреть спецпредложения'},
  hits: {title: 'Хиты продаж', text: 'Популярные товары для летнего ассортимента.', action: 'Смотреть хиты'},
  new: {title: 'Новинки', text: 'Свежие позиции для сезонной витрины.', action: 'Смотреть новинки'},
} as const;

export type Collection = keyof typeof collections;
export const collectionKeys = Object.keys(collections) as Collection[];

export function isCollection(value: string | null): value is Collection {
  return value !== null && Object.hasOwn(collections, value);
}

export function collectionHref(collection: Collection) {
  return '#/catalog?collection=' + collection;
}
