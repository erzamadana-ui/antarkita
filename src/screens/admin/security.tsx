// Admin · Pusat Keamanan: PIN panel, anti-fraud (ringkasan, flag, koefisien), log keamanan, daftar admin
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AdminPage, FilterBar, StatCard, Table, ReasonPrompt, RowActions, adminFont as font, adminTone, adminSpace, adminRadius, adminIcon, AdminCard as Card, EmptyState as Empty } from '@/components/admin';
import { Row, Button, Badge, Input, toast } from '@/components/ui';
import { Entrance, Skeleton } from '@/components/motion';
import { rpc } from '@/lib/supabase';
import { useAdminSecurity, handleAdminError } from '@/store/adminSecurity';
import { useAuth } from '@/store/auth';
import { colors } from '@/lib/theme';
import { rupiah, roleLabelId } from '@/lib/format';
import type { FraudFlag, SecurityEvent } from '@/lib/types';
import { fmtDate, fmtAgo, WideTableHint } from './_shared';

type FraudSummary = { open: number; open_high: number; auto_suspended: number; last_7d: number; by_kind: Record<string, number>; coef: { min: number; max: number; hard: number; budget: number; cancel_limit: number; gps_speed: number; auto_suspend: boolean } };
type Overview = { pin: { has_pin: boolean; unlocked: boolean; unlocked_until: string | null; locked_until: string | null; session_minutes: number } | null; events: SecurityEvent[]; counts_7d: Record<string, number>; admins: { id: string; name: string; has_pin: boolean; unlocked: boolean }[]; fraud: FraudSummary; auto_verified_30d: number; auto_payout_30d: number; bank_verified: number };

export const EVENT_LABEL: Record<string, string> = {
  'fraud.flag': 'Flag anti-fraud', 'fraud.auto_suspend': 'Penangguhan otomatis', 'admin.unlock': 'Panel dibuka (PIN)', 'admin.unlock_failed': 'PIN salah', 'admin.pin_set': 'PIN diatur', 'admin.pin_reset': 'PIN admin direset',
  'admin.export': 'Ekspor data', 'admin.pii_reveal': 'Data pribadi ditampilkan', 'admin.login': 'Login admin', 'payout.auto': 'Pencairan otomatis', 'verify.auto': 'Verifikasi otomatis', 'exec.login': 'Login portal eksekutif', 'exec.login_failed': 'Login eksekutif gagal',
};
const EVENT_COLOR: Record<string, string> = { 'fraud.flag': colors.warning, 'fraud.auto_suspend': colors.danger, 'admin.unlock_failed': colors.danger, 'admin.pii_reveal': colors.accent, 'admin.export': colors.info, 'payout.auto': colors.success, 'verify.auto': colors.success, 'admin.unlock': colors.primary, 'admin.pin_set': colors.primary };
export const FRAUD_KIND_LABEL: Record<string, string> = { cancel_spam: 'Pembatalan berulang', gps_jump: 'Lompatan GPS', shared_device: 'Perangkat bersama', budget_overrun: 'Melebihi anggaran', price_hard_reject: 'Harga ditolak (batas keras)', price_outlier: 'Harga di luar koefisien' };
const SEV_COLOR: Record<string, string> = { high: colors.danger, med: colors.warning, low: colors.info };
const SEV_LABEL: Record<string, string> = { high: 'Tinggi', med: 'Sedang', low: 'Rendah' };
const num = (v: unknown) => Number(v) || 0;

/** Rangkum detail JSON flag menjadi kalimat pendek dalam bahasa Indonesia. */
export function fraudDetailText(f: Pick<FraudFlag, 'kind' | 'detail'>): string {
  const d = f.detail ?? {};
  switch (f.kind) {
    case 'cancel_spam': return `${num(d.cancellations_24h)} pembatalan dalam 24 jam (batas ${num(d.limit)})`;
    case 'gps_jump': return `${num(d.km).toLocaleString('id-ID')} km dalam ${num(d.seconds)} detik · ${num(d.speed_kmh).toLocaleString('id-ID')} km/jam`;
    case 'shared_device': return `${num(d.accounts_same_device)} akun aktif memakai perangkat yang sama`;
    case 'budget_overrun': return `Total nota ${rupiah(num(d.amount))} · batas ${rupiah(num(d.limit))} (anggaran ${rupiah(num(d.budget))})`;
    case 'price_hard_reject': return `${String(d.item ?? 'Barang')}: ${rupiah(num(d.price))} vs acuan ${rupiah(num(d.ref))} (koef ${num(d.coef)}×)`;
    case 'price_outlier': {
      const items = Array.isArray(d.items) ? (d.items as { item?: string; price?: number; ref?: number; coef?: number }[]) : [];
      return `${items.length} bahan di luar koefisien ${num(d.coef_min)}–${num(d.coef_max)}×: ${items.slice(0, 3).map((x) => `${x.item ?? '?'} ${rupiah(num(x.price))}/acuan ${rupiah(num(x.ref))} (${num(x.coef)}×)`).join('; ')}${items.length > 3 ? '; …' : ''}`;
    }
    default: return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || '-';
  }
}
function eventDetailText(e: SecurityEvent): string {
  const d = e.detail ?? {};
  switch (e.kind) {
    case 'fraud.flag': case 'fraud.auto_suspend': return `${FRAUD_KIND_LABEL[String(d.kind)] ?? String(d.kind ?? '')} · ${SEV_LABEL[String(d.severity)] ?? String(d.severity ?? '')}`;
    case 'admin.unlock': return `sesi ${num(d.minutes)} menit`;
    case 'admin.unlock_failed': return `percobaan ke-${num(d.failed)}`;
    case 'admin.export': return `${String(d.what ?? '-')} · ${num(d.rows)} baris`;
    case 'admin.pii_reveal': return `pengguna ${String(d.user_id ?? '-').slice(0, 8)}…`;
    case 'payout.auto': return rupiah(num(d.amount));
    case 'verify.auto': return `${String(d.entity ?? '')} · skor ${num(d.score)}`;
    default: return Object.keys(d).length ? JSON.stringify(d).slice(0, 80) : '';
  }
}

export default function AdminSecurity() {
  const sec = useAdminSecurity();
  const [ov, setOv] = useState<Overview | null>(null);
  const [flags, setFlags] = useState<FraudFlag[] | null>(null);
  const [ftab, setFtab] = useState('open');
  const [pinOld, setPinOld] = useState(''); const [pin1, setPin1] = useState(''); const [pin2, setPin2] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ f: FraudFlag; status: 'confirmed' | 'dismissed'; reinstate: boolean } | null>(null);

  const load = useCallback(async () => {
    try { const o = await rpc<Overview>('admin_security_overview'); setOv(o); if (o?.pin?.session_minutes) setMinutes(String(o.pin.session_minutes)); sec.refresh(); }
    catch (e) { toast.error((e as Error).message); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loadFlags = useCallback(async () => { try { setFlags(await rpc<FraudFlag[]>('admin_fraud_flags', { p_status: ftab })); } catch (e) { toast.error((e as Error).message); setFlags([]); } }, [ftab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFlags(null); loadFlags(); }, [loadFlags]);

  const pin = sec.status ?? ov?.pin ?? null;
  const myId = useAuth((st) => st.session?.user.id);
  const resetPin = async (id: string, name: string) => {
    const ok = Platform.OS === 'web' ? confirm(`Reset PIN admin ${name}? Ia harus mengatur PIN baru sebelum tindakan sensitif.`) : true;
    if (!ok) return;
    try { await sec.ensureUnlocked(); await rpc('admin_reset_pin', { p_user: id }); toast.success('PIN direset'); load(); } catch (e) { handleAdminError(e); }
  };
  const setPin = async () => {
    if (!/^\d{6}$/.test(pin1)) return toast.error('PIN harus 6 digit angka');
    if (pin1 !== pin2) return toast.error('Konfirmasi PIN tidak sama');
    if (pin?.has_pin && pinOld.length < 6) return toast.error('Masukkan PIN lama');
    setBusy(true);
    try { await rpc('admin_set_pin', { p_new: pin1, p_old: pin?.has_pin ? pinOld : null }); toast.success(pin?.has_pin ? 'PIN diperbarui · sesi dibuka' : 'PIN diatur · sesi dibuka'); setPin1(''); setPin2(''); setPinOld(''); await sec.refresh(); load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const lockNow = async () => { try { await sec.lock(); toast.show('Panel dikunci'); load(); } catch (e) { toast.error((e as Error).message); } };
  const saveMinutes = async () => {
    const m = Number(minutes);
    if (!m || m < 5 || m > 720) return toast.error('Durasi 5–720 menit');
    try { await rpc('admin_set_settings', { p: { admin_session_minutes: m } }); toast.success('Durasi sesi disimpan (berlaku pada pembukaan berikutnya)'); load(); } catch (e) { toast.error((e as Error).message); }
  };
  const reviewFlag = async (f: FraudFlag, status: 'confirmed' | 'dismissed', reinstate: boolean, note?: string) => {
    try {
      await rpc('admin_review_fraud', { p_id: f.id, p_status: status, p_note: note ?? null, p_reinstate: reinstate });
      toast.success(status === 'confirmed' ? 'Flag dikonfirmasi' : reinstate ? 'Flag diabaikan & akun dipulihkan' : 'Flag diabaikan'); setAsk(null); loadFlags(); load();
    } catch (e) { handleAdminError(e); }
  };

  const fr = ov?.fraud;
  const byKind = useMemo(() => Object.entries(fr?.by_kind ?? {}).sort((a, b) => b[1] - a[1]), [fr]);
  const untilText = pin?.unlocked && pin.unlocked_until ? new Date(pin.unlocked_until).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <AdminPage title="Pusat Keamanan" subtitle="PIN panel admin, anti-fraud otomatis, log keamanan" onRefresh={async () => { await load(); await loadFlags(); }}>
      <ReasonPrompt visible={!!ask} title={ask?.status === 'confirmed' ? 'Konfirmasi flag sebagai pelanggaran?' : ask?.reinstate ? 'Abaikan flag & pulihkan akun?' : 'Abaikan flag?'} subtitle={ask ? `${FRAUD_KIND_LABEL[ask.f.kind] ?? ask.f.kind} · ${ask.f.subject_name ?? 'akun'}${ask.reinstate ? ' — akun driver dipulihkan (status aktif) dan diberi tahu.' : ''}` : undefined}
        confirmLabel={ask?.status === 'confirmed' ? 'Konfirmasi' : ask?.reinstate ? 'Abaikan & pulihkan' : 'Abaikan'} color={ask?.status === 'confirmed' ? colors.danger : colors.success} optional
        quick={ask?.status === 'confirmed' ? ['Terbukti manipulasi order', 'Nota tidak sesuai harga pasar', 'Akun ganda / perangkat bersama'] : ['Positif palsu (sinyal GPS lemah)', 'Sudah diklarifikasi dengan mitra', 'Harga memang naik di pasar', 'Pembatalan atas permintaan pelanggan']}
        onCancel={() => setAsk(null)} onSubmit={(r) => reviewFlag(ask!.f, ask!.status, ask!.reinstate, r || undefined)} />

      <Row gap={adminSpace.lg} style={{ flexWrap: 'wrap' }}>
        <StatCard index={0} icon="alert-circle-outline" label="Flag terbuka" value={fr?.open ?? 0} hint={`${fr?.open_high ?? 0} prioritas tinggi`} color={(fr?.open_high ?? 0) > 0 ? adminTone.red : adminTone.amber} />
        <StatCard index={1} icon="pause-circle-outline" label="Ditangguhkan otomatis" value={fr?.auto_suspended ?? 0} hint="menunggu peninjauan" color={adminTone.red} />
        <StatCard index={2} icon="time-outline" label="Flag 7 hari" value={fr?.last_7d ?? 0} color={adminTone.blue} />
        <StatCard index={3} icon="shield-checkmark-outline" label="Verifikasi otomatis 30 hari" value={ov?.auto_verified_30d ?? 0} color={adminTone.green} />
        <StatCard index={4} icon="cash-outline" label="Pencairan otomatis 30 hari" value={ov?.auto_payout_30d ?? 0} hint={`${ov?.bank_verified ?? 0} rekening terverifikasi`} color={adminTone.teal} />
      </Row>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Entrance index={1} style={{ flex: 1, minWidth: 320 }}>
          <Card style={{ gap: 10 }}>
            <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
              <Text style={font.label}>PIN panel admin</Text>
              {pin ? <Badge text={!pin.has_pin ? 'Belum diatur' : pin.unlocked ? `Terbuka s.d. ${untilText}` : pin.locked_until ? 'Terkunci (5x salah)' : 'Terkunci'} color={!pin.has_pin ? colors.warning : pin.unlocked ? colors.success : colors.danger} /> : null}
            </Row>
            <Text style={font.small}>Tindakan sensitif (penyesuaian saldo, pencairan, gateway, peran admin) butuh sesi terbuka dengan PIN 6 digit. Lima kali salah mengunci 15 menit. Semua percobaan tercatat di log.</Text>
            {pin?.has_pin ? <Input label="PIN lama" keyboardType="number-pad" secureTextEntry value={pinOld} onChangeText={(v) => setPinOld(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" /> : null}
            <Row gap={8}>
              <Input label={pin?.has_pin ? 'PIN baru' : 'PIN (6 digit)'} keyboardType="number-pad" secureTextEntry value={pin1} onChangeText={(v) => setPin1(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" containerStyle={{ flex: 1 }} />
              <Input label="Konfirmasi" keyboardType="number-pad" secureTextEntry value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" containerStyle={{ flex: 1 }} />
            </Row>
            <Button title={pin?.has_pin ? 'Ubah PIN' : 'Atur PIN'} icon="key-outline" loading={busy} onPress={setPin} />
            {pin?.has_pin ? <Row gap={8} style={{ flexWrap: 'wrap' }}>
              {pin.unlocked ? <Button size="sm" title="Kunci sekarang" variant="outline" color={colors.danger} icon="lock-closed-outline" onPress={lockNow} /> : <Button size="sm" title="Buka kunci" variant="secondary" icon="lock-open-outline" onPress={() => sec.openModal()} />}
            </Row> : null}
            <View style={st.sep} />
            <Text style={font.label}>Durasi sesi</Text>
            <Row gap={8}>
              <Input value={minutes} onChangeText={(v) => setMinutes(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="60" right={<Text style={font.tiny}>menit</Text>} containerStyle={{ flex: 1 }} />
              <Button size="sm" title="Simpan" variant="secondary" onPress={saveMinutes} />
            </Row>
          </Card>
        </Entrance>

        <Entrance index={2} style={{ flex: 1, minWidth: 320 }}>
          <Card style={{ gap: 10 }}>
            <Text style={font.label}>Anti-fraud otomatis</Text>
            <Text style={font.small}>Sistem menandai pembatalan driver berulang (tangguhkan otomatis), lompatan GPS, perangkat bersama, nota belanja melebihi anggaran, dan harga bahan di luar koefisien acuan.</Text>
            {byKind.length === 0 ? <Text style={font.tiny}>Belum ada flag dalam 30 hari.</Text> : byKind.map(([k, n]) => (
              <Row key={k} between><Text style={font.small}>{FRAUD_KIND_LABEL[k] ?? k}</Text><Badge text={`${n}`} color={colors.warning} /></Row>
            ))}
            <View style={st.sep} />
            <Text style={font.label}>Koefisien saat ini</Text>
            {fr?.coef ? (
              <View style={{ gap: 4 }}>
                <KV k="Harga nota vs acuan (ditandai)" v={`< ${fr.coef.min}× atau > ${fr.coef.max}×`} />
                <KV k="Harga nota ditolak" v={`> ${fr.coef.hard}× acuan`} />
                <KV k="Batas total belanja" v={`anggaran × ${fr.coef.budget}`} />
                <KV k="Pembatalan driver / 24 jam" v={`${fr.coef.cancel_limit}× → tangguhkan`} />
                <KV k="Lompatan GPS" v={`> ${fr.coef.gps_speed} km/jam`} />
                <KV k="Tangguhkan otomatis" v={fr.coef.auto_suspend ? 'Aktif' : 'Nonaktif'} />
              </View>
            ) : <Skeleton height={90} />}
            <Text style={font.tiny}>Ubah koefisien di halaman Otomasi (Anti-fraud & koefisien).</Text>
          </Card>
        </Entrance>
      </Row>

      <Entrance index={3}>
        <Card style={{ gap: 12 }}>
          <Row between style={{ flexWrap: 'wrap', gap: 8 }}>
            <Text style={font.label}>Flag anti-fraud</Text>
            <FilterBar value={ftab} onChange={setFtab} options={[{ key: 'open', label: 'Terbuka' }, { key: 'confirmed', label: 'Dikonfirmasi' }, { key: 'dismissed', label: 'Diabaikan' }, { key: 'all', label: 'Semua' }]} />
          </Row>
          {flags === null ? <Skeleton height={80} /> : flags.length === 0 ? <Empty icon="shield-checkmark-outline" title="Tidak ada flag" subtitle={ftab === 'open' ? 'Tidak ada anomali yang menunggu peninjauan.' : 'Belum ada data pada filter ini.'} /> : flags.map((f) => (
            <View key={f.id} style={st.flag}>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                <Badge text={SEV_LABEL[f.severity] ?? f.severity} color={SEV_COLOR[f.severity] ?? colors.textMuted} />
                <Badge text={FRAUD_KIND_LABEL[f.kind] ?? f.kind} color={colors.text} />
                {f.auto_action === 'suspended' ? <Badge text="Ditangguhkan otomatis" color={colors.danger} /> : null}
                {f.status !== 'open' ? <Badge text={f.status === 'confirmed' ? 'Dikonfirmasi' : 'Diabaikan'} color={f.status === 'confirmed' ? colors.danger : colors.success} /> : null}
                <Text style={[font.tiny, { marginLeft: 'auto' }]}>{fmtDate(f.created_at)}</Text>
              </Row>
              <Text style={[font.small, { color: colors.text }]}>{fraudDetailText(f)}</Text>
              <Row gap={12} style={{ flexWrap: 'wrap' }}>
                <Row gap={4}><Ionicons name="person-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.tiny}>{f.subject_name ?? 'Akun tidak diketahui'}{f.subject_role ? ` · ${roleLabelId[f.subject_role] ?? f.subject_role}` : ''}{f.driver_status ? ` · driver ${f.driver_status}` : ''}</Text></Row>
                {f.order_code ? <Row gap={4}><Ionicons name="receipt-outline" size={adminIcon.sm} color={adminTone.faint} /><Text style={font.tiny}>Order {f.order_code}</Text></Row> : null}
              </Row>
              {f.review_note ? <Text style={font.tiny}>Catatan: {f.review_note}{f.reviewed_at ? ` (${fmtDate(f.reviewed_at)})` : ''}</Text> : null}
              {f.status === 'open' ? (
                <RowActions
                  primary={[{ key: 'ignore', label: 'Abaikan', icon: 'checkmark-done-outline', variant: 'soft' as const, onPress: () => setAsk({ f, status: 'dismissed', reinstate: false }) }]}
                  menu={[
                    (f.auto_action === 'suspended' || f.driver_status === 'suspended') && { key: 'restore', label: 'Abaikan & pulihkan akun', icon: 'refresh', color: colors.success, onPress: () => setAsk({ f, status: 'dismissed', reinstate: true }) },
                    { key: 'confirm', label: 'Konfirmasi pelanggaran…', icon: 'alert-circle-outline', danger: true, onPress: () => setAsk({ f, status: 'confirmed', reinstate: false }) },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </Card>
      </Entrance>

      <Row gap={16} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Entrance index={4} style={{ flex: 2, minWidth: 360 }}>
          <Card padded={false}>
            <View style={{ padding: 14, gap: 6 }}>
              <Text style={font.label}>Log keamanan (100 terakhir)</Text>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>{Object.entries(ov?.counts_7d ?? {}).map(([k, n]) => <Badge key={k} text={`${EVENT_LABEL[k] ?? k}: ${n}`} color={EVENT_COLOR[k] ?? colors.textMuted} />)}{!ov || Object.keys(ov.counts_7d ?? {}).length === 0 ? <Text style={font.tiny}>Tidak ada kejadian 7 hari terakhir.</Text> : null}</Row>
            </View>
            <Table rows={(ov?.events ?? []) as unknown as Record<string, unknown>[]} emptyText="Belum ada kejadian" columns={[
              { key: 'created_at', label: 'Waktu', width: 118, render: (r) => <Text style={font.tiny}>{fmtDate(String(r.created_at))}</Text> },
              { key: 'kind', label: 'Kejadian', width: 156, render: (r) => <Badge text={EVENT_LABEL[String(r.kind)] ?? String(r.kind)} color={EVENT_COLOR[String(r.kind)] ?? colors.textMuted} /> },
              { key: 'user_name', label: 'Pengguna', width: 126, render: (r) => <Text style={font.small} numberOfLines={1}>{String(r.user_name ?? '-')}</Text> },
              { key: 'detail', label: 'Detail', width: 190, render: (r) => <Text style={font.tiny} numberOfLines={2}>{eventDetailText(r as unknown as SecurityEvent)}</Text> },
            ]} />
          </Card>
        </Entrance>
        <Entrance index={5} style={{ flex: 1, minWidth: 280 }}>
          <Card style={{ gap: 10 }}>
            <Text style={font.label}>Admin & status PIN</Text>
            {(ov?.admins ?? []).map((a) => (
              <Row key={a.id} between style={{ gap: 8 }}>
                <Text style={[font.h3, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                <Badge text={!a.has_pin ? 'Tanpa PIN' : a.unlocked ? 'Sesi terbuka' : 'Terkunci'} color={!a.has_pin ? colors.warning : a.unlocked ? colors.success : colors.textMuted} />
                {a.has_pin && a.id !== myId ? <Button title="Reset PIN" size="sm" variant="outline" color={colors.danger} onPress={() => resetPin(a.id, a.name)} /> : null}
              </Row>
            ))}
            {ov && ov.admins.length === 0 ? <Text style={font.tiny}>Tidak ada akun admin.</Text> : null}
            <Text style={font.tiny}>Admin yang lupa PIN: minta admin lain menekan "Reset PIN" (butuh sesi terbuka), lalu atur PIN baru di halaman ini.</Text>
            <View style={st.sep} />
            <Text style={font.label}>Rekening mitra terverifikasi</Text>
            <Text style={font.small}>{ov?.bank_verified ?? 0} rekening terverifikasi. Pencairan otomatis hanya untuk rekening terverifikasi (≤ batas per transaksi & harian, tanpa flag terbuka). Rekening otomatis terverifikasi saat penarikan pertama disetujui manual; cabut/tandai lewat halaman Keuangan.</Text>
          </Card>
        </Entrance>
      </Row>
      <WideTableHint />
    </AdminPage>
  );
}

function KV({ k, v }: { k: string; v: string }) { return <Row between style={{ gap: 12 }}><Text style={[font.small, { flex: 1 }]}>{k}</Text><Text style={font.mono}>{v}</Text></Row>; }

const st = StyleSheet.create({
  sep: { height: 1, backgroundColor: adminTone.border, marginVertical: 2 },
  flag: { gap: 6, padding: adminSpace.md, borderRadius: adminRadius.card, borderWidth: 1, borderColor: adminTone.border, backgroundColor: adminTone.surfaceAlt },
});
