import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const pages = mode === 'github-pages';
  if (pages) {
    const {VITE_SHOP_API_ORIGIN: origin} = loadEnv(mode, process.cwd(), 'VITE_');
    const api = origin ? new URL(origin) : undefined;
    if (!api || api.protocol !== 'https:' || api.origin !== origin) {
      throw new Error('VITE_SHOP_API_ORIGIN must contain one HTTPS origin without a path.');
    }
  }
  return {
    plugins: [react()],
    base: pages ? '/Magazin_OPT/' : '/',
    build: {target: 'es2022'},
  };
});
