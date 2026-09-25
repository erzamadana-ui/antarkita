#!/usr/bin/env bash
# =====================================================================
# scripts/uji-rollback.sh — uji rollback migrasi Finpay v3 + AntarVoucher (0105–0112) di harness LOKAL
#
# Memakai database TERPISAH (default antarkita_rb) — database utama `antarkita` tidak disentuh.
#   1. database segar dimigrasi s.d. 0104                     → skema C (baseline v2)
#   2. migrasi penuh (0105–0111)                               → skema A1
#   3. rollback penuh 0111_down … 0105_down                    → skema B;  B harus = C
#   4. migrasi ulang                                           → skema A2; A2 harus = A1
#   5. rollback sebagian (0111_down, 0110_down, 0109_down) + migrasi ulang → skema A3; A3 harus = A1
#   6. seed + uji e2e, v2, v3 pada database hasil up→down→up   → semua harus 0 BUG
# Perbedaan yang DIKETAHUI & disaring: nilai enum ledger_entry v3 (PostgreSQL tidak bisa DROP VALUE).
#
#   scripts/uji-rollback.sh            # semua langkah
#   UJI_ROLLBACK_TANPA_TES=1 scripts/uji-rollback.sh   # tanpa langkah 6
# =====================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RB_DIR="$ROOT_DIR/supabase/rollback"
DB="${UJI_ROLLBACK_DB:-antarkita_rb}"
OUT="${DB_LOKAL_LOG_DIR:-${TMPDIR:-/tmp}/antarkita-db-lokal}/rollback"
mkdir -p "$OUT"
export PGHOST="${DB_HOST:-127.0.0.1}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USER:-postgres}"
export PGOPTIONS="-c client_min_messages=warning"
LOKAL=("$SCRIPT_DIR/db-lokal.sh")
gagal=0

info() { printf '\e[1m==>\e[0m %s\n' "$*"; }
lulus() { printf '\e[32m  LULUS\e[0m %s\n' "$*"; }
jatuh() { printf '\e[31m  GAGAL\e[0m %s\n' "$*"; gagal=1; }

dump() {   # skema saja, termasuk hak akses; enum ledger_entry v3 dinormalkan
  pg_dump -s -d "$DB" --no-comments \
    | sed -E "/^    '(customer_receivable|wallet_liability|tax_output|dispute|unreconciled|payout_fee|ads_impression_cost|ads_click_cost)',?$/d" \
    | sed -E "s/^    'ads_revenue',$/    'ads_revenue'/" \
    | grep -vE '^-- (Dumped|Started|Completed)|^\\(un)?restrict ' \
    | python3 -c 'import sys
buf = []
for line in sys.stdin:
    if line.startswith(("GRANT ", "REVOKE ")): buf.append(line); continue
    sys.stdout.write("".join(sorted(buf))); buf = []; sys.stdout.write(line)
sys.stdout.write("".join(sorted(buf)))' > "$1"   # urutan GRANT dalam satu objek tidak bermakna
}
bandingkan() {   # $1 label, $2 berkas harapan, $3 berkas hasil
  if diff -u "$2" "$3" > "$OUT/diff-$1.txt"; then lulus "$1: skema identik ($(wc -l < "$3") baris)"
  else jatuh "$1: skema berbeda — $(grep -cE '^[+-][^+-]' "$OUT/diff-$1.txt") baris, lihat $OUT/diff-$1.txt"; head -40 "$OUT/diff-$1.txt"; fi
}
down() {   # jalankan skrip rollback berurutan (tiap berkas satu transaksi)
  local v
  for v in "$@"; do
    if psql -X -q -v ON_ERROR_STOP=1 -1 -d "$DB" -f "$RB_DIR/${v}_down.sql" > "$OUT/down-$v.log" 2>&1; then
      printf '     %s_down ... ok\n' "$v"
    else
      printf '     %s_down ... GAGAL\n' "$v"; grep -E 'ERROR|CONTEXT' "$OUT/down-$v.log" | head -8; exit 1
    fi
  done
}
migrate() { DB_NAME="$DB" "${LOKAL[@]}" migrate > "$OUT/migrate-$1.log" 2>&1 || { tail -20 "$OUT/migrate-$1.log"; exit 1; }; grep -E 'diterapkan' "$OUT/migrate-$1.log" | sed 's/^/     /'; }

info "1. database segar $DB s.d. 0104 (baseline v2)"
psql -X -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" > /dev/null
psql -X -q -d postgres -c "drop database if exists \"$DB\"" > /dev/null
DB_NAME="$DB" DB_LOKAL_MIG_UNTIL=0104 "${LOKAL[@]}" migrate > "$OUT/migrate-baseline.log" 2>&1 || { tail -20 "$OUT/migrate-baseline.log"; exit 1; }
grep -E 'diterapkan' "$OUT/migrate-baseline.log" | sed 's/^/     /'
dump "$OUT/C-baseline.sql"

info "2. migrasi 0105–0112"
migrate up1
dump "$OUT/A1-up.sql"

info "3. rollback penuh 0112 → 0105"
down 0112 0111 0110 0109 0108 0107 0106 0105
dump "$OUT/B-down.sql"
bandingkan "down-vs-baseline" "$OUT/C-baseline.sql" "$OUT/B-down.sql"
n="$(psql -X -q -At -d "$DB" -c "select count(*) from _lokal.migrasi where nama >= '0105'")"
[[ "$n" == "0" ]] && lulus "catatan _lokal.migrasi 0105–0111 terhapus" || jatuh "_lokal.migrasi masih mencatat $n migrasi v3"

info "4. migrasi ulang (up → down → up)"
migrate up2
dump "$OUT/A2-reup.sql"
bandingkan "reup-vs-up" "$OUT/A1-up.sql" "$OUT/A2-reup.sql"

info "5. rollback sebagian (0112, 0111, 0110, 0109) + migrasi ulang"
down 0112 0111 0110 0109
migrate up3
dump "$OUT/A3-partial.sql"
bandingkan "partial-reup-vs-up" "$OUT/A1-up.sql" "$OUT/A3-partial.sql"

if [[ "${UJI_ROLLBACK_TANPA_TES:-0}" != "1" ]]; then
  info "6. seed + uji pada database hasil up→down→up"
  DB_NAME="$DB" "${LOKAL[@]}" seed > "$OUT/seed.log" 2>&1 || { tail -20 "$OUT/seed.log"; exit 1; }
  for t in simulasi_e2e.sql uji_skema_bisnis_v2.sql uji_finpay_v3.sql uji_antarvoucher.sql; do
    if DB_NAME="$DB" "${LOKAL[@]}" test "$ROOT_DIR/supabase/tests/$t" > "$OUT/test-$t.log" 2>&1; then
      lulus "$(grep -E "^$t:" "$OUT/test-$t.log")"
    else
      jatuh "$(grep -E "^$t:" "$OUT/test-$t.log" || echo "$t tanpa hasil")"; grep -E ' BUG ' "$OUT/test-$t.log" | head -10
    fi
  done
fi

printf '\n'
if [[ $gagal -eq 0 ]]; then info "uji rollback LULUS (log: $OUT)"; else info "uji rollback GAGAL (log: $OUT)"; exit 1; fi
