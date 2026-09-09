// Bangun 3 aplikasi web ke satu folder dist/ (GitHub Pages):
//   dist/          → AntarKita (pelanggan)   base: $BASE
//   dist/mitra/    → AntarKita Mitra          base: $BASE/mitra
//   dist/admin/    → AntarKita Admin          base: $BASE/admin
// Env: EXPO_PUBLIC_BASE_URL (mis. /antarkita), EXPO_PUBLIC_SITE_ROOT (https://user.github.io/antarkita)
import { execSync } from 'child_process';
import fs from 'fs';
const base = (process.env.EXPO_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const site = process.env.EXPO_PUBLIC_SITE_ROOT || `https://erzamadana-ui.github.io${base}`;
fs.rmSync('dist', { recursive: true, force: true });
for (const [app, sub] of [['pelanggan', ''], ['mitra', '/mitra'], ['admin', '/admin']]) {
  console.log(`\n▶ expo export ${app} (base ${base}${sub})`);
  execSync(`npx expo export --platform web --output-dir dist${sub}`, {
    stdio: 'inherit',
    env: { ...process.env, APP: app, EXPO_PUBLIC_APP: app, EXPO_PUBLIC_BASE_URL: `${base}${sub}`, EXPO_PUBLIC_SITE_ROOT: site, EXPO_PUBLIC_SITE_URL: `${site}${sub}` },
  });
}
// 404.html: SPA fallback yang mengarahkan ke aplikasi yang tepat berdasarkan awalan path
fs.writeFileSync('dist/404.html', `<!doctype html><meta charset="utf-8"><title>AntarKita</title><script>
(function(){var b=${JSON.stringify(base)};var p=location.pathname;var app=b+'/';
if(p.indexOf(b+'/mitra')===0)app=b+'/mitra/';else if(p.indexOf(b+'/admin')===0)app=b+'/admin/';
var rel=p.slice(app.length-1)||'/';location.replace(app+'?r='+encodeURIComponent(rel+location.search+location.hash));})();
</script>`);
fs.writeFileSync('dist/.nojekyll', '');

// Halaman statis hukum untuk Play Store / App Store (URL wajib publik):
//   docs/rilis/privacy.html → dist/privacy/index.html → https://<pages>/antarkita/privacy/
//   docs/rilis/terms.html   → dist/terms/index.html   → https://<pages>/antarkita/terms/
//   docs/rilis/hapus-akun.html → dist/hapus-akun/index.html → https://<pages>/antarkita/hapus-akun/
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
console.log('\n✔ dist/ siap: pelanggan, mitra, admin + 404.html + privacy/ + terms/ + hapus-akun/');
