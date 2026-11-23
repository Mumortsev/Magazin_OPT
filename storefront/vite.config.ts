import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const pages = mode === 'github-pages';
  let adminUrl: string | undefined;
  if (pages) {
    const {VITE_SHOP_API_ORIGIN: origin} = loadEnv(mode, process.cwd(), 'VITE_');
    const api = origin ? new URL(origin) : undefined;
    if (!api || api.protocol !== 'https:' || api.origin !== origin) {
      throw new Error('VITE_SHOP_API_ORIGIN must contain one HTTPS origin without a path.');
    }
    adminUrl = new URL('/admin', api).href;
  }
  return {
    plugins: [
      react(),
      {
        name: 'pages-admin-entry',
        apply: 'build',
        generateBundle() {
          if (!adminUrl) return;
          this.emitFile({
            type: 'asset',
            fileName: 'admin/index.html',
            source: `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="0; url=${adminUrl}">
  <title>Вход для сотрудников — Курортник</title>
</head>
<body>
  <main>
    <h1>Вход для сотрудников</h1>
    <p><a href="${adminUrl}">Открыть админ-панель</a></p>
    <p><a href="../">Вернуться в магазин</a></p>
  </main>
</body>
</html>`,
          });
        },
      },
    ],
    base: pages ? '/Magazin_OPT/' : '/',
    build: {target: 'es2022'},
  };
});
