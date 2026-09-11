// Uji ujung-ke-ujung gerbang wilayah operasi dengan Playwright (Chromium) + server tiruan.
//
// Yang dibuktikan:
//   1. Pelanggan di kota BELUM DILAYANI melihat pesan yang benar ("AntarKita belum
//      melayani Medan") lengkap dengan penjelasan dan tombol daftar tunggu.
//   2. Ia TIDAK BISA menyelesaikan pemesanan: tombol pesan nonaktif, dan alasannya
//      TERTULIS DI TOMBOL (bukan tombol yang hilang tanpa penjelasan).
//   3. Meski UI dilewati — memanggil create_order langsung seperti orang yang memakai
//      kunci anon — SERVER tetap menolak dengan pesan Bahasa Indonesia yang jelas.
//   4. Data tempat (apotek, pasar, minimarket) TETAP bisa ditelusuri di kota itu.
//   5. Sakelar per layanan: sesudah admin membuka Medan hanya untuk AntarShop & AntarSend,
//      AntarShop bisa dipesan sementara AntarRide tetap ditolak — dan pelanggan diberi tahu
//      layanan mana yang sudah bisa.
//   6. Kota "segera" memakai kalimat yang lebih lembut dan tetap membuka daftar tunggu.
//   7. Titik jauh dari kota mana pun ditolak dengan alasan jarak.
//   8. Daftar tunggu benar-benar tercatat di server (bukan sekadar notifikasi di layar).
//   9. Gagal-aman: bila RPC status gagal, layanan TIDAK ikut terkunci di klien
//      (server tetap menjadi penjaga terakhir).
//
// Jalankan:
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//   NODE_PATH=$(npm root -g) node tests/kota/uji-kota.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { chromium } = require_(process.env.PLAYWRIGHT_MODULE || 'playwright');

const PORT = Number(process.env.PORT || 4281);
const BASE = `http://localhost:${PORT}`;

let lulus = 0, gagal = 0;
const ok = (nama, syarat, detail = '') => {
  if (syarat) { lulus++; console.log(`[OK]    ${nama}${detail ? ' — ' + detail : ''}`); }
  else { gagal++; console.error(`[GAGAL] ${nama}${detail ? ' — ' + detail : ''}`); }
};

async function main() {
  const srv = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname],
    { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('harness kota') && r()));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const post = (path, body) => page.evaluate(async ([p, b]) => {
    const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    return { ok: r.ok, data: await r.json().catch(() => null) };
  }, [path, body]);

  await page.goto(BASE);
  await page.waitForFunction(() => window.__siap);

  /** Pilih lokasi + layanan, lalu tunggu render selesai. */
  const setel = async (tempat, layanan) => {
    await page.selectOption('#tempat', tempat);
    await page.selectOption('#layanan', layanan);
    await page.evaluate(() => window.__segarkan());
  };
  const tombol = () => page.evaluate(() => ({
    disabled: document.getElementById('pesan').disabled,
    text: document.getElementById('pesan').textContent.trim(),
  }));
  const kartu = () => page.evaluate(() => ({
    tampil: !document.getElementById('notice').hidden,
    headline: document.getElementById('headline').textContent.trim(),
    body: document.getElementById('body').textContent.trim(),
    avail: document.getElementById('avail').textContent.trim(),
    waitlist: !document.getElementById('waitlist').hidden,
  }));

  // ---------------------------------------------------------------- 1. Kota aktif
  await setel('0.5071,101.4478', 'ride_motor');
  {
    const b = await tombol(); const k = await kartu();
    ok('1a. Kota aktif: tombol pesan hidup', b.disabled === false, b.text);
    ok('1b. Kota aktif: tidak ada kartu peringatan', k.tampil === false);
    await page.click('#pesan');
    await page.waitForFunction(() => document.getElementById('log').textContent.trim() !== '');
    const log = await page.textContent('#log');
    ok('1c. Kota aktif: pesanan benar-benar dibuat', /Pesanan dibuat/.test(log), log.trim());
  }

  // ------------------------------------------------- 2. Kota belum dilayani (Medan)
  await setel('3.5952,98.6722', 'ride_motor');
  {
    const k = await kartu(); const b = await tombol();
    ok('2a. Pesan yang dilihat pelanggan benar',
       k.tampil && k.headline === 'AntarKita belum melayani Medan', k.headline);
    ok('2b. Penjelasannya jujur: data tetap bisa ditelusuri, pesanan belum bisa',
       /tetap bisa Anda telusuri/.test(k.body) && /driver belum tersedia/.test(k.body));
    ok('2c. Tombol "Beri tahu saya kalau sudah ada" tersedia', k.waitlist);
    ok('2d. Pelanggan TIDAK BISA menyelesaikan pemesanan (tombol nonaktif)', b.disabled === true);
    ok('2e. Alasannya tertulis di tombol, bukan tombol hilang',
       /Belum melayani Medan/.test(b.text), b.text);

    const tempat = await page.$$eval('.tempat', (n) => n.map((x) => x.textContent));
    ok('2f. Data tempat tetap bisa ditelusuri di kota yang belum dilayani', tempat.length === 3, tempat.join(' · '));
  }

  // ------------------------------------ 3. Melewati UI: panggil create_order langsung
  {
    const r = await post('/mock/rpc/create_order', {
      p: { service: 'ride_motor', pickup: { lat: 3.5952, lng: 98.6722 }, dropoff: { lat: 3.61, lng: 98.68 } },
    });
    ok('3a. SERVER menolak pesanan walau UI dilewati', r.ok === false);
    ok('3b. Pesan penolakan server Bahasa Indonesia & menyebut kota',
       typeof r.data?.message === 'string' && r.data.message.includes('Medan'), r.data?.message);
  }

  // ------------------------------------------------------ 4. Daftar tunggu tercatat
  {
    await page.click('#waitlist');
    await page.waitForFunction(() => /Terima kasih/.test(document.getElementById('log').textContent));
    const st = await page.evaluate(async () => (await fetch('/mock/state')).json());
    const row = st.waitlist.find((w) => w.city_name === 'Medan');
    ok('4a. Minat pelanggan tersimpan di server', !!row, row ? `${row.city_name}: ${row.services.join(',')}` : '');
    ok('4b. Layanan yang diinginkan ikut tercatat', row?.services?.includes('ride_motor'));
    await page.evaluate(() => { document.getElementById('log').textContent = ''; });
    await page.click('#waitlist');   // mendaftar dua kali
    await page.waitForFunction(() => document.getElementById('log').textContent.trim() !== '');
    const st2 = await page.evaluate(async () => (await fetch('/mock/state')).json());
    ok('4c. Mendaftar ulang tidak menggandakan baris', st2.waitlist.filter((w) => w.city_name === 'Medan').length === 1);
  }

  // ----------------------------------------- 5. Sakelar PER LAYANAN (strategi pemilik)
  {
    const r = await post('/mock/admin/set_city', { city: 'Medan', status: 'aktif', services: ['shop', 'send'] });
    ok('5a. Admin membuka Medan hanya untuk AntarShop & AntarSend', r.ok === true);

    await setel('3.5952,98.6722', 'shop');
    const bShop = await tombol();
    ok('5b. AntarShop bisa dipesan di Medan', bShop.disabled === false, bShop.text);

    await setel('3.5952,98.6722', 'ride_motor');
    const bRide = await tombol(); const kRide = await kartu();
    ok('5c. AntarRide tetap terkunci di kota yang sama', bRide.disabled === true);
    ok('5d. Alasan per layanan jelas di tombol',
       bRide.text === 'AntarRide belum dibuka di Medan', bRide.text);
    ok('5e. Pelanggan diberi tahu layanan mana yang SUDAH bisa',
       /AntarSend/.test(kRide.body) && /AntarShop/.test(kRide.body), kRide.body);
    ok('5f. Ringkasan "sudah bisa / belum dibuka" tampil',
       /Sudah bisa: AntarSend, AntarShop/.test(kRide.avail) && /AntarRide/.test(kRide.avail), kRide.avail);

    const bypass = await post('/mock/rpc/create_order', {
      p: { service: 'ride_motor', pickup: { lat: 3.5952, lng: 98.6722 } },
    });
    ok('5g. Server juga menolak layanan yang belum dibuka di kota aktif',
       bypass.ok === false && /AntarRide belum dibuka di Medan/.test(bypass.data?.message ?? ''), bypass.data?.message);
  }

  // ------------------------------------------------------------ 6. Kota "segera"
  await setel('1.0456,104.0305', 'ride_motor');
  {
    const k = await kartu(); const b = await tombol();
    ok('6a. Kota "segera" memakai kalimat yang lebih lembut',
       k.headline === 'AntarKita segera hadir di Batam', k.headline);
    ok('6b. Daftar tunggu dibuka untuk kota "segera"', k.waitlist);
    ok('6c. Pesanan tetap terkunci di kota "segera"', b.disabled === true, b.text);
  }

  // --------------------------------------------------- 7. Titik di luar semua kota
  await setel('-8.65,115.21', 'ride_motor');
  {
    const k = await kartu(); const b = await tombol();
    ok('7a. Titik jauh dari kota mana pun ditolak',
       b.disabled === true && k.headline === 'AntarKita belum menjangkau lokasi ini', k.headline);
    ok('7b. Alasannya menyebut jarak, bukan sekadar "tidak tersedia"',
       /km dari/.test(k.body), k.body);
    const r = await post('/mock/rpc/create_order', { p: { service: 'ride_motor', pickup: { lat: -8.65, lng: 115.21 } } });
    ok('7c. Server menolak titik di luar wilayah layanan',
       r.ok === false && /luar wilayah layanan/.test(r.data?.message ?? ''), r.data?.message);
  }

  // ------------------------------------------------------------ 8. Sifat gagal-aman
  {
    await post('/mock/fail', { on: true });
    await setel('3.5952,98.6722', 'ride_motor');
    const b = await tombol();
    ok('8. Gangguan jaringan TIDAK mengunci aplikasi (server tetap penjaga terakhir)',
       b.disabled === false, b.text);
    await post('/mock/fail', { on: false });
  }

  // ------------------------- 9. Membuka kota tanpa menyebut layanan ditolak server
  {
    const r = await post('/mock/admin/set_city', { city: 'Jakarta', status: 'aktif', services: [] });
    ok('9. Membuka kota wajib menyebut layanan mana yang dibuka',
       r.ok === false && /harus menyebut layanan/.test(r.data?.message ?? ''), r.data?.message);
  }

  await browser.close();
  srv.kill();
  console.log(`\nRingkasan: ${lulus} lulus, ${gagal} gagal`);
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
