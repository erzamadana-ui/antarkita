// Bangun 3 aplikasi web ke satu folder dist/ (GitHub Pages, domain kustom https://apps.antarkitaindonesia.com/):
//   dist/          → AntarKita (pelanggan)   base: $BASE        → https://apps.antarkitaindonesia.com/
//   dist/mitra/    → AntarKita Mitra          base: $BASE/mitra  → https://apps.antarkitaindonesia.com/mitra/
//   dist/admin/    → AntarKita Admin          base: $BASE/admin  → https://apps.antarkitaindonesia.com/admin/
// Env:
//   EXPO_PUBLIC_BASE_URL  — awalan path (KOSONG untuk domain kustom; "/antarkita" hanya bila kembali ke sub-path repo)
//   EXPO_PUBLIC_SITE_ROOT — akar situs absolut (default https://apps.antarkitaindonesia.com)
//   PAGES_CNAME           — isi berkas dist/CNAME (default: host dari SITE_ROOT bila bukan *.github.io).
//                           Set PAGES_CNAME=- untuk TIDAK menulis CNAME (mis. uji lokal ke sub-path).
// URL lama https://erzamadana-ui.github.io/antarkita/… tetap hidup: GitHub Pages mengalihkannya ke domain kustom.
import { execSync } from 'child_process';
import fs from 'fs';
const DEFAULT_SITE = 'https://apps.antarkitaindonesia.com';
const base = (process.env.EXPO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const site = (process.env.EXPO_PUBLIC_SITE_ROOT || (base ? `https://erzamadana-ui.github.io${base}` : DEFAULT_SITE)).replace(/\/$/, '');
const siteHost = new URL(site).host;
const cname = process.env.PAGES_CNAME === '-' ? '' : (process.env.PAGES_CNAME || (siteHost.endsWith('.github.io') ? '' : siteHost));
if (cname && base) console.warn(`⚠ PAGES_CNAME=${cname} tetapi EXPO_PUBLIC_BASE_URL=${base}: domain kustom dilayani dari akar, base path seharusnya kosong.`);
fs.rmSync('dist', { recursive: true, force: true });
for (const [app, sub] of [['pelanggan', ''], ['mitra', '/mitra'], ['admin', '/admin']]) {
  console.log(`\n▶ expo export ${app} (base ${base}${sub || '/'} → ${site}${sub}/)`);
  execSync(`npx expo export --platform web --output-dir dist${sub}`, {
    stdio: 'inherit',
    env: { ...process.env, APP: app, EXPO_PUBLIC_APP: app, EXPO_PUBLIC_BASE_URL: `${base}${sub}`, EXPO_PUBLIC_SITE_ROOT: site, EXPO_PUBLIC_SITE_URL: `${site}${sub}` },
  });
}
// 404.html: SPA fallback yang mengarahkan ke aplikasi yang tepat berdasarkan awalan path.
// Dengan base "" (domain kustom): /mitra/... → /mitra/?r=..., /admin/... → /admin/?r=..., selainnya → /?r=...
fs.writeFileSync('dist/404.html', `<!doctype html><meta charset="utf-8"><title>AntarKita</title><script>
(function(){var b=${JSON.stringify(base)};var p=location.pathname;var app=b+'/';
if(p.indexOf(b+'/mitra')===0)app=b+'/mitra/';else if(p.indexOf(b+'/admin')===0)app=b+'/admin/';
var rel=p.slice(app.length-1)||'/';location.replace(app+'?r='+encodeURIComponent(rel+location.search+location.hash));})();
</script>`);
fs.writeFileSync('dist/.nojekyll', '');

// CNAME domain kustom GitHub Pages. WAJIB ada di artefak setiap deploy: actions/deploy-pages mengganti
// seluruh isi situs, dan tanpa berkas ini GitHub menghapus setelan "Custom domain" di Settings → Pages
// sehingga situs kembali ke erzamadana-ui.github.io/antarkita dan semua tautan di Play Console 404.
if (cname) { fs.writeFileSync('dist/CNAME', cname); console.log(`• dist/CNAME → ${cname}`); }
else console.log('• dist/CNAME tidak ditulis (situs di *.github.io / PAGES_CNAME=-)');

// Halaman statis hukum untuk Play Store / App Store (URL wajib publik):
//   docs/rilis/privacy.html    → dist/privacy/index.html    → https://apps.antarkitaindonesia.com/privacy/
//   docs/rilis/terms.html      → dist/terms/index.html      → https://apps.antarkitaindonesia.com/terms/
//   docs/rilis/hapus-akun.html → dist/hapus-akun/index.html → https://apps.antarkitaindonesia.com/hapus-akun/
//     (URL hapus akun WAJIB Google Play; sebelumnya hanya diterbitkan oleh workflow CI sehingga
//      build lokal diam-diam kehilangan halaman ini)
// Berkas ini ada secara fisik di dist/, sehingga GitHub Pages melayaninya langsung; 404.html di atas hanya
// dijalankan untuk path yang TIDAK ada (SPA fallback) dan tidak menyentuh /privacy/ maupun /terms/.
for (const [src, dir] of [['docs/rilis/privacy.html', 'privacy'], ['docs/rilis/terms.html', 'terms'], ['docs/rilis/hapus-akun.html', 'hapus-akun']]) {
  if (!fs.existsSync(src)) { console.warn(`⚠ ${src} tidak ditemukan — halaman /${dir}/ dilewati`); continue; }
  fs.mkdirSync(`dist/${dir}`, { recursive: true });
  fs.copyFileSync(src, `dist/${dir}/index.html`);
  console.log(`• ${src} → dist/${dir}/index.html (${site}/${dir}/)`);
}
console.log(`\n✔ dist/ siap: pelanggan, mitra, admin + 404.html + privacy/ + terms/ + hapus-akun/${cname ? ' + CNAME' : ''} → ${site}/`);
