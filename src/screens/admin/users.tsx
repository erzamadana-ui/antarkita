// Admin · Pengguna — peran, saldo, akses eksekutif, kontak (chat/telepon), hapus akun (PIN + alasan).
// Data pribadi tersamar; aksi "Tampilkan" tercatat sebagai admin.pii_reveal di log keamanan.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import {
  AdminPage, DataTable, Toolbar, ReasonPrompt, StatCard, Grid, Pill, AdminDialog, SoftChip,
  ContactActions, DeleteButton, DeletePartnerDialog, Truncate,
  adminFont as font, adminTone, adminSpace,
} from '@/components/admin';
import { Row, Button, toast, Input } from '@/components/ui';
import { execLevelLabel } from '@/lib/format';
import { rpc, supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { formatDate, phoneDisplay, phoneMasked, rupiah } from '@/lib/format';
import { adminExportCsv } from '@/lib/csv';
import { handleAdminError, useAdminSecurity } from '@/store/adminSecurity';
import type { Profile, UserRole, Wallet } from '@/lib/types';

type Row_ = Profile & { balance: number };
/** Samarkan email: na••@gmail.com */
const emailMasked = (e?: string | null) => { if (!e) return '-'; const [u, d] = e.split('@'); return `${(u ?? '').slice(0, 2)}••@${d ?? ''}`; };
const ROLE_LABEL: Record<UserRole, string> = { customer: 'Pelanggan', driver: 'Driver', merchant: 'Merchant', admin: 'Admin' };

export default function AdminUsers() {
  const [rows, setRows] = useState<Row_[]>([]);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [del, setDel] = useState<{ kind: 'user'; id: string; name: string; meta?: string[] } | null>(null);

  const load = useCallback(async () => {
    const [{ data: p }, { data: w }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('wallets').select('*'),
    ]);
    const wm = new Map(((w as Wallet[]) ?? []).map((x) => [x.user_id, x.balance]));
    setRows(((p as Profile[]) ?? []).map((x) => ({ ...x, balance: wm.get(x.id) ?? 0 })));
  }, []);
  useEffect(() => { load(); }, [load]);

  const [ask, setAsk] = useState<{ id: string; name: string } | null>(null);
  const [execFor, setExecFor] = useState<Row_ | null>(null);
  const [execLevel, setExecLevel] = useState('vp'); const [execPin, setExecPin] = useState('');
  const grantExec = async (active: boolean) => {
    if (!execFor) return;
    if (active && execPin && execPin.length < 6) return toast.error('PIN minimal 6 digit');
    try { await rpc('admin_set_exec', { p_user: execFor.id, p_level: execLevel, p_pin: execPin || null, p_active: active }); toast.success(active ? `Akses eksekutif ${execLevelLabel[execLevel]} diberikan` : 'Akses eksekutif dicabut'); setExecFor(null); setExecPin(''); }
    catch (e) { toast.error((e as Error).message); }
  };
  const setUser = async (id: string, patch: { role?: UserRole; active?: boolean; reason?: string }) => {
    if (patch.active === false && patch.reason === undefined) { setAsk({ id, name: rows.find((r) => r.id === id)?.full_name ?? 'pengguna' }); return; }
    if (patch.role === 'admin' && !(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_set_user', { p_user: id, p_role: patch.role ?? null, p_active: patch.active ?? null, p_reason: patch.reason ?? null }); toast.success('Diperbarui & tercatat di log'); setAsk(null); load(); }
    catch (e) { handleAdminError(e); }
  };
  // Data pribadi (telepon/email) tersamar; "Tampilkan" mencatat admin.pii_reveal di log keamanan
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const reveal = async (u: Row_) => {
    try { await rpc('admin_log_event', { p_kind: 'admin.pii_reveal', p_detail: { user_id: u.id } }); setRevealed((r) => ({ ...r, [u.id]: true })); }
    catch (e) { toast.error((e as Error).message); }
  };
  const exportCsv = () => adminExportCsv('users', `pengguna-${new Date().toISOString().slice(0, 10)}.csv`, ['ID', 'Nama', 'Email', 'Telepon', 'Peran', 'Saldo', 'Aktif', 'Daftar'], shown.map((u) => [u.id, u.full_name, u.email, phoneDisplay(u.phone), u.role, u.balance, u.is_active ? 'ya' : 'tidak', u.created_at]));
  const [adjusting, setAdjusting] = useState<Row_ | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const adjust = (u: Row_) => { setAdjusting(u); setAmount(''); setNote(''); };
  const runAdjust = async () => {
    const n = Number(amount.replace(/[^\d-]/g, ''));
    if (!adjusting || !n) return toast.error('Masukkan nominal (negatif untuk mengurangi)');
    if (!(await useAdminSecurity.getState().ensureUnlocked())) return;
    try { await rpc('admin_adjust_wallet', { p_user: adjusting.id, p_amount: n, p_note: note || 'Penyesuaian admin' }); toast.success('Saldo disesuaikan'); setAdjusting(null); load(); }
    catch (e) { handleAdminError(e); }
  };
  const shown = rows.filter((r) => (filter === 'all' || r.role === filter)
    && (!q || r.full_name.toLowerCase().includes(q.toLowerCase()) || (r.email ?? '').toLowerCase().includes(q.toLowerCase()) || (r.phone ?? '').includes(q)));
  const roleColor: Record<UserRole, string> = { customer: adminTone.blue, driver: adminTone.teal, merchant: adminTone.orange, admin: adminTone.violet };
  const nRole = (r: UserRole) => rows.filter((x) => x.role === r).length;

  return (
    <AdminPage title="Pengguna" subtitle={`${rows.length} akun · data pribadi tersamar, tampilkan per baris (tercatat di log keamanan)`} onRefresh={load}
      right={Platform.OS === 'web' ? <Button size="sm" title="Ekspor CSV" icon="download-outline" variant="outline" onPress={exportCsv} /> : undefined}>
      <ReasonPrompt visible={!!ask} title={`Nonaktifkan akun ${ask?.name}?`} subtitle="Akun tidak bisa memesan/menerima order. Alasan tersimpan di Log Aktivitas." onCancel={() => setAsk(null)} onSubmit={(r) => setUser(ask!.id, { active: false, reason: r })} confirmLabel="Nonaktifkan" />
      <DeletePartnerDialog target={del} onClose={() => setDel(null)} onDeleted={load} />

      <Grid gap={adminSpace.lg}>
        <StatCard index={0} icon="people-outline" label="Total akun" value={rows.length} color={adminTone.teal} />
        <StatCard index={1} icon="person-outline" label="Pelanggan" value={nRole('customer')} color={adminTone.blue} />
        <StatCard index={2} icon="bicycle-outline" label="Driver" value={nRole('driver')} color={adminTone.green} />
        <StatCard index={3} icon="close-circle-outline" label="Nonaktif" value={rows.filter((r) => !r.is_active).length} color={adminTone.red} />
      </Grid>

      <Toolbar q={q} onQ={setQ} placeholder="Cari nama / email / HP"
        filters={[{ key: 'all', label: `Semua (${rows.length})` }, { key: 'customer', label: 'Pelanggan' }, { key: 'driver', label: 'Driver' }, { key: 'merchant', label: 'Merchant' }, { key: 'admin', label: 'Admin' }]}
        filter={filter} onFilter={setFilter} />

      <DataTable rows={shown as unknown as Record<string, unknown>[]} emptyText="Tidak ada pengguna pada filter ini" emptyIcon="people-outline" columns={[
        {
          key: 'name', label: 'Pengguna', width: 250, flex: 2, render: (r) => {
            const u = r as unknown as Row_; const open = !!revealed[u.id];
            return (
              <View style={{ minWidth: 0 }}>
                <Truncate style={font.bodyStrong} title={u.full_name}>{u.full_name}</Truncate>
                <Row gap={6} style={{ flexWrap: 'wrap' }}>
                  <Truncate style={font.tiny} title={open ? `${u.email ?? '-'} · ${phoneDisplay(u.phone)}` : undefined}>{open ? `${u.email ?? '-'} · ${phoneDisplay(u.phone)}` : `${emailMasked(u.email)} · ${phoneMasked(u.phone)}`}</Truncate>
                  {!open ? <Pressable onPress={() => reveal(u)} hitSlop={6}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11.5 }}>Tampilkan</Text></Pressable> : null}
                </Row>
              </View>
            );
          },
        },
        { key: 'role', label: 'Peran', width: 110, render: (r) => <Pill text={ROLE_LABEL[r.role as UserRole] ?? String(r.role)} color={roleColor[r.role as UserRole]} /> },
        { key: 'balance', label: 'Saldo', width: 120, align: 'right', render: (r) => <Text style={font.mono}>{rupiah(Number(r.balance))}</Text> },
        {
          key: 'is_active', label: 'Status', width: 140, render: (r) => (
            <View style={{ gap: 3, minWidth: 0 }}>
              <Pill text={r.is_active ? 'Aktif' : 'Nonaktif'} tone={r.is_active ? 'ok' : 'off'} />
              {!r.is_active && r.status_reason ? <Truncate style={font.tiny} title={String(r.status_reason)} lines={2}>{String(r.status_reason)}</Truncate> : null}
            </View>
          ),
        },
        { key: 'created_at', label: 'Daftar', width: 110, render: (r) => <Text style={font.tiny}>{formatDate(String(r.created_at), false)}</Text> },
        {
          key: 'contact', label: 'Kontak', width: 180, render: (r) => {
            const u = r as unknown as Row_;
            return <ContactActions userId={u.id} name={u.full_name} role={u.role} subject={`Panel admin · ${u.full_name}`} />;
          },
        },
        {
          key: 'actions', label: 'Aksi', width: 360, render: (r) => {
            const u = r as unknown as Row_;
            return (
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                <Button size="sm" title="Saldo ±" variant="outline" onPress={() => adjust(u)} />
                {u.is_active
                  ? <Button size="sm" title="Nonaktifkan" variant="outline" color={colors.warning} onPress={() => setUser(u.id, { active: false })} />
                  : <Button size="sm" title="Aktifkan" color={colors.success} onPress={() => setUser(u.id, { active: true, reason: 'Diaktifkan kembali oleh admin' })} />}
                {u.role !== 'admin'
                  ? <Button size="sm" title="Jadikan admin" variant="ghost" onPress={() => setUser(u.id, { role: 'admin' })} />
                  : <Button size="sm" title="Cabut admin" variant="ghost" color={colors.danger} onPress={() => setUser(u.id, { role: 'customer' })} />}
                <Button size="sm" title="Eksekutif" variant="ghost" color="#0B1F2A" icon="shield-half-outline" onPress={() => { setExecFor(u); setExecPin(''); }} />
                <DeleteButton onPress={() => setDel({ kind: 'user', id: u.id, name: u.full_name, meta: [ROLE_LABEL[u.role] ?? u.role, `saldo ${rupiah(u.balance)}`] })} />
              </Row>
            );
          },
        },
      ]} />

      <AdminDialog visible={!!execFor} onClose={() => setExecFor(null)} title={`Akses Portal Eksekutif · ${execFor?.full_name ?? ''}`}
        subtitle="Portal eksekutif (/exec) butuh login kedua dengan PIN 6 digit. Hanya level Vice President ke atas & pemegang saham. Setiap login tercatat di log.">
        <Row gap={6} style={{ flexWrap: 'wrap' }}>{Object.entries(execLevelLabel).map(([k, l]) => <SoftChip key={k} label={l} active={execLevel === k} onPress={() => setExecLevel(k)} color="#0B1F2A" />)}</Row>
        <Input label="PIN eksekutif (6 digit) — kosongkan bila tidak diubah" keyboardType="number-pad" secureTextEntry value={execPin} onChangeText={(v) => setExecPin(v.replace(/\D/g, '').slice(0, 8))} placeholder="••••••" />
        <Row gap={8} style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button size="sm" title="Batal" variant="ghost" onPress={() => setExecFor(null)} />
          <Button size="sm" title="Cabut akses" variant="outline" color={colors.danger} onPress={() => grantExec(false)} />
          <Button size="sm" title="Beri / perbarui akses" color="#0B1F2A" onPress={() => grantExec(true)} />
        </Row>
      </AdminDialog>

      <AdminDialog visible={!!adjusting} onClose={() => setAdjusting(null)} title={`Penyesuaian saldo · ${adjusting?.full_name ?? ''}`}
        subtitle={`Saldo saat ini ${rupiah(adjusting?.balance ?? 0)}. Nominal negatif untuk mengurangi.`}>
        <Input label="Nominal (Rp)" keyboardType="numbers-and-punctuation" value={amount} onChangeText={setAmount} placeholder="50000 atau -25000" />
        <Input label="Catatan" value={note} onChangeText={setNote} placeholder="Alasan penyesuaian" />
        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
          <Button size="sm" title="Batal" variant="ghost" onPress={() => setAdjusting(null)} />
          <Button size="sm" title="Terapkan" onPress={runAdjust} />
        </Row>
      </AdminDialog>
    </AdminPage>
  );
}
