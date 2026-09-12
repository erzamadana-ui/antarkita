// Admin · Kota & Wilayah — gerbang operasi AntarKita (migrasi 0076–0080).
//
// Halaman ini menjawab satu pertanyaan pemilik: "kota mana yang boleh menerima
// pesanan, dan layanan apa saja di sana?" Data tempat memang diisi untuk seluruh
// Indonesia, tetapi pesanan hanya dibuka satu per satu.
//
// KESALAHAN TERMAHAL yang dicegah halaman ini: membuka kota yang belum punya driver.
// Karena itu tombol "Buka kota" TIDAK langsung bekerja — ia memunculkan dialog yang
// menampilkan JUMLAH DRIVER AKTIF di kota itu dan memaksa admin memilih layanan mana
// yang dibuka. Kalau drivernya nol, peringatan merah muncul dan admin harus mengetik
// ulang nama kota untuk melanjutkan.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AdminPage, Table, Toolbar, Panel, Pill, StatCard, Grid, Col, AdminDialog, AdminSelect,
  IconAction, adminFont as font, adminTone, adminSpace, adminIcon, adminRadius,
} from '@/components/admin';
import { Row, Button, toast } from '@/components/ui';
import { rpc } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { SERVICE_LABEL } from '@/hooks/useCityStatus';
import type { AdminCityRow, AdminManagerOption, AdminWaitlistRow, ServiceType } from '@/lib/types';
import { fmtAgo, WideTableHint } from './_shared';

const SERVICES: ServiceType[] = ['ride_motor', 'ride_car', 'food', 'send', 'box', 'shop', 'market', 'travel'];

type StatusKey = 'aktif' | 'segera' | 'belum_dilayani';
const STATUS_LABEL: Record<StatusKey, string> = {
  aktif: 'Aktif · melayani',
  segera: 'Segera · daftar tunggu',
  belum_dilayani: 'Belum dilayani',
};
const STATUS_TONE: Record<StatusKey, 'ok' | 'info' | 'off'> = { aktif: 'ok', segera: 'info', belum_dilayani: 'off' };

export default function AdminKota() {
  const [rows, setRows] = useState<AdminCityRow[]>([]);
  const [managers, setManagers] = useState<AdminManagerOption[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Kota yang sedang dibuka lewat dialog konfirmasi. */
  const [opening, setOpening] = useState<AdminCityRow | null>(null);
  /** Kota yang daftar tunggunya sedang dilihat. */
  const [waitlistOf, setWaitlistOf] = useState<AdminCityRow | null>(null);
  const [waitlist, setWaitlist] = useState<AdminWaitlistRow[] | null>(null);
  /** Kota yang sedang ditunjuk Perwakilan Kotanya. */
  const [picOf, setPicOf] = useState<AdminCityRow | null>(null);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([
      rpc<AdminCityRow[]>('admin_list_cities', { p_q: null }).catch(() => [] as AdminCityRow[]),
      rpc<AdminManagerOption[]>('admin_city_manager_options').catch(() => [] as AdminManagerOption[]),
    ]);
    setRows(c ?? []); setManagers(m ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const shown = useMemo(() => rows.filter((r) => {
    if (filter !== 'all' && r.service_status !== filter) return false;
    const k = q.trim().toLowerCase();
    return !k || r.name.toLowerCase().includes(k) || (r.province ?? '').toLowerCase().includes(k);
  }), [rows, filter, q]);

  const totals = useMemo(() => ({
    aktif: rows.filter((r) => r.service_status === 'aktif').length,
    segera: rows.filter((r) => r.service_status === 'segera').length,
    tertutup: rows.filter((r) => r.service_status === 'belum_dilayani').length,
    waitlist: rows.reduce((n, r) => n + (r.waitlist ?? 0), 0),
  }), [rows]);

  /** Buka/tutup satu layanan di satu kota. Menutup tidak perlu konfirmasi — menutup selalu aman. */
  const toggleService = async (city: AdminCityRow, sv: ServiceType) => {
    const on = !city.services?.[sv];
    if (on && city.service_status !== 'aktif') {
      return toast.error(`${city.name} masih berstatus "${STATUS_LABEL[city.service_status]}". Buka kotanya dulu.`);
    }
    if (on && (city.drivers?.approved ?? 0) === 0
      && !(await confirmNoDriver(city.name, SERVICE_LABEL[sv]))) return;
    setBusy(`${city.id}:${sv}`);
    try {
      await rpc('admin_set_city_service', { p_city_id: city.id, p_service: sv, p_enabled: on });
      toast.success(`${SERVICE_LABEL[sv]} ${on ? 'dibuka' : 'ditutup'} di ${city.name}`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  /** Menutup kota: satu ketukan, langsung berlaku (menutup tidak pernah merugikan pelanggan). */
  const closeCity = async (city: AdminCityRow, status: 'segera' | 'belum_dilayani') => {
    setBusy(city.id);
    try {
      await rpc('admin_set_city_status', { p_city_id: city.id, p_status: status, p_services: null, p_note: null });
      toast.success(`${city.name} → ${STATUS_LABEL[status]}`);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const openWaitlist = async (city: AdminCityRow) => {
    setWaitlistOf(city); setWaitlist(null);
    try { setWaitlist(await rpc<AdminWaitlistRow[]>('admin_city_waitlist', { p_city_id: city.id, p_limit: 200 })); }
    catch (e) { toast.error((e as Error).message); setWaitlist([]); }
  };

  return (
    <AdminPage
      title="Kota & Wilayah"
      subtitle="Data tempat diisi untuk seluruh Indonesia, tetapi pesanan hanya dibuka di kota yang Anda pilih. Kota tertutup tetap bisa ditelusuri pelanggan — hanya tombol pesannya yang dikunci."
      onRefresh={refresh} refreshing={refreshing}>

      <Grid>
        <Col span={3}><StatCard icon="checkmark-circle-outline" label="Kota melayani" value={totals.aktif} hint="menerima pesanan" color={adminTone.teal} index={0} /></Col>
        <Col span={3}><StatCard icon="time-outline" label="Segera hadir" value={totals.segera} hint="daftar tunggu dibuka" color={colors.info} index={1} /></Col>
        <Col span={3}><StatCard icon="map-outline" label="Belum dilayani" value={totals.tertutup} hint="data ada, pesanan tertutup" color={adminTone.slate} index={2} /></Col>
        <Col span={3}><StatCard icon="people-outline" label="Peminat menunggu" value={totals.waitlist} hint="calon pelanggan mendaftar" color={colors.accent} index={3} /></Col>
      </Grid>

      <Panel
        title="Daftar kota"
        subtitle="Sakelar per layanan: hijau = dibuka, abu = tertutup. Ketuk untuk mengubah."
        icon="globe-outline">
        <Toolbar q={q} onQ={setQ} placeholder="Cari kota atau provinsi…"
          filter={filter} onFilter={setFilter}
          filters={[
            { key: 'all', label: `Semua (${rows.length})` },
            { key: 'aktif', label: `Aktif (${totals.aktif})` },
            { key: 'segera', label: `Segera (${totals.segera})` },
            { key: 'belum_dilayani', label: `Belum dilayani (${totals.tertutup})` },
          ]} />
        <WideTableHint />
        <Table
          rows={shown as unknown as Record<string, unknown>[]}
          emptyText="Belum ada kota"
          emptyIcon="map-outline"
          columns={[
            {
              key: 'name', label: 'Kota', width: 180, render: (r) => {
                const c = r as unknown as AdminCityRow;
                return (
                  <View style={{ minWidth: 0 }}>
                    <Text style={font.bodyStrong} numberOfLines={1}>{c.name}</Text>
                    <Text style={font.tiny} numberOfLines={1}>{c.province ?? '—'} · radius {Math.round(c.radius_km)} km</Text>
                  </View>
                );
              },
            },
            {
              key: 'service_status', label: 'Status', width: 150, render: (r) => {
                const c = r as unknown as AdminCityRow;
                return (
                  <View style={{ gap: 3, minWidth: 0 }}>
                    <Pill text={STATUS_LABEL[c.service_status]} tone={STATUS_TONE[c.service_status]} />
                    {c.status_changed_at ? <Text style={font.tiny} numberOfLines={1}>{fmtAgo(c.status_changed_at)}</Text> : null}
                  </View>
                );
              },
            },
            {
              key: 'drivers', label: 'Driver aktif', width: 116, render: (r) => {
                const c = r as unknown as AdminCityRow;
                const n = c.drivers?.approved ?? 0;
                return (
                  <View style={{ gap: 2 }}>
                    <Text style={[font.bodyStrong, { color: n === 0 ? colors.danger : adminTone.ink }]}>{n}</Text>
                    <Text style={font.tiny}>{c.drivers?.online ?? 0} online</Text>
                  </View>
                );
              },
            },
            {
              key: 'services', label: 'Layanan yang dibuka', width: 430, render: (r) => {
                const c = r as unknown as AdminCityRow;
                return (
                  <Row gap={5} style={{ flexWrap: 'wrap' }}>
                    {SERVICES.map((sv) => {
                      const on = !!c.services?.[sv];
                      const wait = busy === `${c.id}:${sv}`;
                      return (
                        <ServiceToggle key={sv} label={SERVICE_LABEL[sv].replace('Antar', '')} on={on} busy={wait}
                          onPress={() => toggleService(c, sv)} />
                      );
                    })}
                  </Row>
                );
              },
            },
            {
              key: 'waitlist', label: 'Daftar tunggu', width: 118, render: (r) => {
                const c = r as unknown as AdminCityRow;
                return (
                  <IconAction icon="people-outline" label={`${c.waitlist ?? 0}${c.waitlist_30d ? ` (+${c.waitlist_30d})` : ''}`}
                    color={(c.waitlist ?? 0) > 0 ? colors.accent : adminTone.muted}
                    title="Lihat siapa saja yang menunggu di kota ini"
                    onPress={() => openWaitlist(c)} />
                );
              },
            },
            {
              key: 'manager_name', label: 'Perwakilan Kota', width: 168, render: (r) => {
                const c = r as unknown as AdminCityRow;
                return (
                  <IconAction icon={c.manager_name ? 'person-circle-outline' : 'person-add-outline'}
                    label={c.manager_name ?? 'Tunjuk PIC'}
                    color={c.manager_name ? adminTone.teal : adminTone.muted}
                    title="Tunjuk admin penanggung jawab kota ini"
                    onPress={() => setPicOf(c)} />
                );
              },
            },
            {
              key: 'aksi', label: 'Aksi', width: 210, render: (r) => {
                const c = r as unknown as AdminCityRow;
                const wait = busy === c.id;
                if (c.service_status === 'aktif') {
                  return (
                    <Row gap={6} style={{ flexWrap: 'wrap' }}>
                      <Button title="Tutup kota" size="sm" variant="outline" color={colors.danger} loading={wait}
                        onPress={() => closeCity(c, 'belum_dilayani')} />
                      <Button title="Ubah layanan" size="sm" variant="ghost" onPress={() => setOpening(c)} />
                    </Row>
                  );
                }
                return (
                  <Row gap={6} style={{ flexWrap: 'wrap' }}>
                    <Button title="Buka kota" size="sm" icon="lock-open-outline" onPress={() => setOpening(c)} />
                    {c.service_status === 'belum_dilayani'
                      ? <Button title="Segera" size="sm" variant="ghost" loading={wait} onPress={() => closeCity(c, 'segera')} />
                      : <Button title="Tutup" size="sm" variant="ghost" loading={wait} onPress={() => closeCity(c, 'belum_dilayani')} />}
                  </Row>
                );
              },
            },
          ]} />
      </Panel>

      <OpenCityDialog city={opening} onClose={() => setOpening(null)} onDone={async () => { setOpening(null); await load(); }} />
      <WaitlistDialog city={waitlistOf} rows={waitlist} onClose={() => { setWaitlistOf(null); setWaitlist(null); }} />
      <ManagerDialog city={picOf} options={managers} onClose={() => setPicOf(null)} onDone={async () => { setPicOf(null); await load(); }} />
    </AdminPage>
  );
}

/** Pil sakelar layanan: hijau saat dibuka, abu saat tertutup. */
function ServiceToggle({ label, on, busy, onPress }: { label: string; on: boolean; busy?: boolean; onPress: () => void }) {
  return (
    <Button
      title={label} size="sm"
      variant={on ? 'primary' : 'outline'}
      color={on ? colors.success : adminTone.muted}
      loading={busy}
      onPress={onPress}
      style={{ minWidth: 74 }} />
  );
}

// ---------------------------------------------------------------------------
// Dialog BUKA KOTA — di sinilah kesalahan termahal dicegah
// ---------------------------------------------------------------------------
function OpenCityDialog({ city, onClose, onDone }: { city: AdminCityRow | null; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<ServiceType[]>([]);
  const [note, setNote] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!city) { setPicked([]); setNote(''); setConfirmName(''); return; }
    setPicked(SERVICES.filter((sv) => !!city.services?.[sv]));
    setNote(city.status_note ?? '');
    setConfirmName('');
  }, [city?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!city) return null;
  const drivers = city.drivers?.approved ?? 0;
  const online = city.drivers?.online ?? 0;
  const noDriver = drivers === 0;
  // Tanpa driver, membuka kota harus SULIT dilakukan tanpa sadar: nama kota wajib diketik ulang.
  const nameOk = !noDriver || confirmName.trim().toLowerCase() === city.name.toLowerCase();
  const canSubmit = picked.length > 0 && nameOk && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await rpc('admin_set_city_status', {
        p_city_id: city.id, p_status: 'aktif', p_services: picked, p_note: note.trim() || null,
      });
      toast.success(`${city.name} dibuka untuk ${picked.length} layanan`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminDialog visible onClose={onClose} width={600}
      title={city.service_status === 'aktif' ? `Ubah layanan · ${city.name}` : `Buka kota ${city.name}`}
      subtitle="Pelanggan di kota ini akan langsung bisa memesan layanan yang Anda centang.">
      <View style={{ gap: adminSpace.lg, marginTop: adminSpace.md }}>

        {/* Jumlah driver — angka inilah alasan dialog ini ada */}
        <View style={[dlg.box, { borderColor: noDriver ? colors.danger + '55' : colors.success + '55', backgroundColor: noDriver ? colors.dangerLight : colors.successLight }]}>
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <Ionicons name={noDriver ? 'warning' : 'shield-checkmark'} size={20} color={noDriver ? colors.danger : colors.success} />
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text style={[font.bodyStrong, { color: noDriver ? colors.danger : adminTone.ink }]}>
                {drivers} driver disetujui di sekitar {city.name} · {online} sedang online
              </Text>
              <Text style={font.small}>
                {noDriver
                  ? 'BELUM ADA DRIVER DI KOTA INI. Kalau kota dibuka sekarang, setiap pesanan akan mencari driver lalu gagal — inilah penyebab ulasan bintang satu yang paling sering. Rekrut driver dulu, atau setel kota ke "Segera" supaya pelanggan bisa mendaftar di daftar tunggu.'
                  : `Hitungan diambil dari posisi terakhir driver dalam radius ${Math.round(city.radius_km)} km dari pusat kota.`}
              </Text>
            </View>
          </Row>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={font.label}>Layanan yang dibuka (wajib pilih minimal satu)</Text>
          <Text style={font.tiny}>Buka layanan yang paling mudah Anda kendalikan lebih dulu. Layanan yang tidak dicentang akan tertutup di kota ini.</Text>
          <Row gap={6} style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {SERVICES.map((sv) => {
              const on = picked.includes(sv);
              return (
                <Button key={sv} title={SERVICE_LABEL[sv]} size="sm"
                  variant={on ? 'primary' : 'outline'} color={on ? colors.success : adminTone.muted}
                  onPress={() => setPicked((p) => (on ? p.filter((x) => x !== sv) : [...p, sv]))} />
              );
            })}
          </Row>
          {picked.length === 0 ? <Text style={[font.tiny, { color: colors.danger }]}>Belum ada layanan yang dipilih — kota tidak bisa dibuka.</Text> : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={font.label}>Catatan status (opsional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Mis. mulai operasi 1 Oktober, 12 driver siap"
            placeholderTextColor={adminTone.faint} style={dlg.input} />
        </View>

        {noDriver ? (
          <View style={{ gap: 6 }}>
            <Text style={[font.label, { color: colors.danger }]}>Ketik nama kota untuk melanjutkan tanpa driver</Text>
            <TextInput value={confirmName} onChangeText={setConfirmName} placeholder={city.name}
              placeholderTextColor={adminTone.faint} autoCapitalize="none"
              style={[dlg.input, { borderColor: nameOk ? colors.success : colors.danger }]} />
          </View>
        ) : null}

        <Row gap={8}>
          <Button title="Batal" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
          <Button title={city.service_status === 'aktif' ? 'Simpan layanan' : `Buka ${city.name}`}
            style={{ flex: 1 }} color={noDriver ? colors.danger : colors.primary}
            disabled={!canSubmit} loading={busy} onPress={submit} />
        </Row>
      </View>
    </AdminDialog>
  );
}

// ---------------------------------------------------------------------------
function WaitlistDialog({ city, rows, onClose }: { city: AdminCityRow | null; rows: AdminWaitlistRow[] | null; onClose: () => void }) {
  if (!city) return null;
  return (
    <AdminDialog visible onClose={onClose} width={640}
      title={`Daftar tunggu · ${city.name}`}
      subtitle={`${city.waitlist ?? 0} orang mendaftar (${city.waitlist_30d ?? 0} dalam 30 hari terakhir). Kota dengan peminat terbanyak layak dibuka lebih dulu.`}>
      <View style={{ marginTop: adminSpace.md }}>
        {rows === null ? <Text style={font.small}>Memuat…</Text> : (
          <Table
            maxHeight={380}
            rows={rows as unknown as Record<string, unknown>[]}
            emptyText="Belum ada yang mendaftar di kota ini"
            emptyIcon="people-outline"
            columns={[
              { key: 'name', label: 'Nama', flex: 1, width: 160, render: (r) => <Text style={font.body} numberOfLines={1}>{String((r as unknown as AdminWaitlistRow).name ?? '—')}</Text> },
              { key: 'phone', label: 'Kontak', width: 150 },
              {
                key: 'services', label: 'Layanan diminta', width: 210, render: (r) => {
                  const w = r as unknown as AdminWaitlistRow;
                  const list = (w.services ?? []).map((sv) => SERVICE_LABEL[sv] ?? sv);
                  return <Text style={font.small} numberOfLines={2}>{list.length ? list.join(', ') : '—'}</Text>;
                },
              },
              { key: 'created_at', label: 'Mendaftar', width: 110, render: (r) => <Text style={font.tiny}>{fmtAgo(String((r as unknown as AdminWaitlistRow).created_at))}</Text> },
            ]} />
        )}
      </View>
    </AdminDialog>
  );
}

// ---------------------------------------------------------------------------
function ManagerDialog({ city, options, onClose, onDone }: {
  city: AdminCityRow | null; options: AdminManagerOption[]; onClose: () => void; onDone: () => void;
}) {
  const [pick, setPick] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPick(city?.manager_id ?? ''); setNote(city?.manager_note ?? ''); }, [city?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!city) return null;

  const save = async (clear = false) => {
    setBusy(true);
    try {
      await rpc('admin_set_city_manager', {
        p_city_id: city.id, p_manager_id: clear ? null : (pick || null), p_note: note.trim() || null,
      });
      toast.success(clear ? `Perwakilan Kota ${city.name} dicabut` : `Perwakilan Kota ${city.name} disimpan`);
      onDone();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminDialog visible onClose={onClose} width={520}
      title={`Perwakilan Kota · ${city.name}`}
      subtitle="Admin penanggung jawab operasi kota ini: rekrutmen driver, mitra, dan mutu layanan setempat.">
      <View style={{ gap: adminSpace.lg, marginTop: adminSpace.md }}>
        <AdminSelect label="Pengguna admin" icon="person-outline" width="100%" placeholder="Pilih admin"
          value={pick} options={options.map((o) => ({ value: o.id, label: o.name ?? '(tanpa nama)', sublabel: o.phone ?? undefined }))}
          onChange={setPick} searchable />
        {options.length === 0 ? <Text style={[font.tiny, { color: colors.danger }]}>Belum ada pengguna berperan admin yang aktif.</Text> : null}
        <View style={{ gap: 6 }}>
          <Text style={font.label}>Catatan tugas (opsional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Mis. fokus rekrutmen driver motor kuartal ini"
            placeholderTextColor={adminTone.faint} style={dlg.input} />
        </View>
        <Row gap={8}>
          {city.manager_id ? <Button title="Cabut" variant="outline" color={colors.danger} style={{ flex: 1 }} loading={busy} onPress={() => save(true)} /> : null}
          <Button title="Simpan" style={{ flex: 1 }} disabled={!pick || busy} loading={busy} onPress={() => save(false)} />
        </Row>
      </View>
    </AdminDialog>
  );
}

/** Konfirmasi ringan saat membuka SATU layanan di kota tanpa driver. */
function confirmNoDriver(city: string, service: string): Promise<boolean> {
  const msg = `${city} belum punya driver aktif. Membuka ${service} sekarang berarti pesanan akan mencari driver lalu gagal. Lanjutkan?`;
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { confirm?: unknown }).confirm === 'function') {
    return Promise.resolve(Boolean((globalThis as unknown as { confirm: (m: string) => boolean }).confirm(msg)));
  }
  toast.error(msg);
  return Promise.resolve(false);
}

const dlg = {
  box: { borderRadius: adminRadius.card, borderWidth: 1, padding: adminSpace.lg },
  input: {
    height: 36, borderRadius: adminRadius.md, borderWidth: 1, borderColor: adminTone.border,
    backgroundColor: adminTone.surface, paddingHorizontal: 10, fontSize: 14, color: adminTone.ink,
  },
} as const;
