#!/usr/bin/env bash
# =====================================================================
# scripts/db-lokal.sh — harness PostgreSQL 16 LOKAL untuk AntarKita
#
# Menjalankan supabase/migrations, supabase/seed.sql, dan supabase/tests
# pada cluster PostgreSQL lokal (tanpa Supabase CLI/Docker, tanpa
# menyentuh produksi). Lapisan platform Supabase (auth, storage, pg_cron,
# pg_net, realtime) ditiru oleh scripts/db-lokal/00_supabase_stub.sql.
#
#   scripts/db-lokal.sh reset          # drop+create db, stub, migrasi, seed, uji e2e, ringkasan
#   scripts/db-lokal.sh migrate        # (idempoten) stub + migrasi yang belum diterapkan
#   scripts/db-lokal.sh seed           # seed.sql dengan app.seed_password (tolak bila sudah pernah)
#   scripts/db-lokal.sh test <file>    # jalankan satu berkas SQL uji (blok DO yang ROLLBACK)
#   scripts/db-lokal.sh test           # = test supabase/tests/simulasi_e2e.sql
#   scripts/db-lokal.sh psql [args]    # psql interaktif ke db lokal
#   scripts/db-lokal.sh status         # keadaan cluster/db/migrasi
#
# Variabel lingkungan (opsional):
#   DB_NAME=antarkita   DB_USER=postgres   DB_HOST=127.0.0.1   DB_PORT=5432
#   SEED_PASSWORD=UjiLokal123   PG_VERSION=16   PG_CLUSTER=main
#   DB_LOKAL_NO_SUDO=1  (lewati pengelolaan cluster; anggap server sudah jalan)
#
# Idempoten: semua langkah aman diulang. Butuh sudo/root hanya untuk
# menyalakan cluster & mengaktifkan trust-auth di localhost.
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
STUB_SQL="$SCRIPT_DIR/db-lokal/00_supabase_stub.sql"
PRA_DIR="$SCRIPT_DIR/db-lokal/pra"      # pra/<nama-berkas>.sql: dijalankan tepat sebelum migrasi/seed itu (transaksi sama)
PASCA_DIR="$SCRIPT_DIR/db-lokal/pasca"  # pasca/<nama-berkas>.sql: dijalankan tepat sesudahnya (transaksi sama)
KNOWN_BUGS="$SCRIPT_DIR/db-lokal/bug-dikenal.txt"  # skenario uji yang diketahui gagal (bukan salah harness)
MIG_DIR="$ROOT_DIR/supabase/migrations"
SEED_SQL="$ROOT_DIR/supabase/seed.sql"
E2E_SQL="$ROOT_DIR/supabase/tests/simulasi_e2e.sql"
IDEMP_SQL="$ROOT_DIR/supabase/tests/uji_idempotensi.sql"

DB_NAME="${DB_NAME:-antarkita}"
DB_USER="${DB_USER:-postgres}"      # migrasi dijalankan sebagai `postgres` seperti di Supabase
                                    # (0003: alter default privileges FOR ROLE postgres)
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
SEED_PASSWORD="${SEED_PASSWORD:-UjiLokal123}"
PG_VERSION="${PG_VERSION:-16}"
PG_CLUSTER="${PG_CLUSTER:-main}"
PG_FALLBACK_CLUSTER="antarkita"
PG_FALLBACK_DIR="/var/lib/postgresql/${PG_VERSION}/${PG_FALLBACK_CLUSTER}"
LOG_DIR="${DB_LOKAL_LOG_DIR:-${TMPDIR:-/tmp}/antarkita-db-lokal}"
mkdir -p "$LOG_DIR"

export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGDATABASE="$DB_NAME"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
unset PGPASSWORD || true

# ringkasan
N_MIG_APPLIED=0; N_MIG_SKIPPED=0; SEED_RESULT="-"; E2E_RESULT="-"; IDEMP_RESULT="-"

# ---------------------------------------------------------------------
# util
# ---------------------------------------------------------------------
c_bold=$'\e[1m'; c_dim=$'\e[2m'; c_red=$'\e[31m'; c_grn=$'\e[32m'; c_yel=$'\e[33m'; c_off=$'\e[0m'
[[ -t 1 ]] || { c_bold=; c_dim=; c_red=; c_grn=; c_yel=; c_off=; }
info() { printf '%s==>%s %s\n' "$c_bold" "$c_off" "$*"; }
ok()   { printf '%s  ok%s  %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s  !!%s  %s\n' "$c_yel" "$c_off" "$*" >&2; }
die()  { printf '%sGAGAL:%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

SUDO=""
if [[ "${DB_LOKAL_NO_SUDO:-0}" != "1" ]]; then
  if [[ $(id -u) -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
  fi
fi
as_root() { if [[ -n "$SUDO" ]]; then $SUDO "$@"; else "$@"; fi; }
as_pg()   { as_root su postgres -s /bin/bash -c "$*"; }   # psql via socket unix, peer auth

need() { command -v "$1" >/dev/null 2>&1 || die "perintah '$1' tidak ditemukan (pasang postgresql-client-$PG_VERSION)"; }

# psql standar untuk migrasi/tests: berhenti pada error pertama, tanpa halaman
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --pset pager=off)

db_ready() { pg_isready -q -h "$DB_HOST" -p "$DB_PORT" 2>/dev/null; }

# cluster (versi + nama) yang benar-benar melayani DB_PORT, dari pg_lsclusters;
# dipakai agar pg_hba/reload menyasar cluster yang tepat walau PG_CLUSTER di env berbeda
detect_cluster_by_port() {
  command -v pg_lsclusters >/dev/null 2>&1 || return 0
  local line
  line="$(pg_lsclusters -h 2>/dev/null | awk -v p="$DB_PORT" '$3==p && $4=="online" {print $1" "$2; exit}')"
  if [[ -n "$line" ]]; then
    PG_VERSION="${line% *}"; PG_CLUSTER="${line#* }"
  fi
}

# ---------------------------------------------------------------------
# 1. cluster
# ---------------------------------------------------------------------
ensure_cluster() {
  need psql; need pg_isready
  if db_ready; then
    detect_cluster_by_port
    ok "server PostgreSQL sudah menerima koneksi di $DB_HOST:$DB_PORT (cluster $PG_VERSION/$PG_CLUSTER)"
    return
  fi
  [[ "${DB_LOKAL_NO_SUDO:-0}" == "1" ]] && die "server tidak jalan di $DB_HOST:$DB_PORT dan DB_LOKAL_NO_SUDO=1"
  command -v pg_lsclusters >/dev/null 2>&1 || die "pg_lsclusters tidak ada — pasang postgresql-common / postgresql-$PG_VERSION"

  local status
  status="$(pg_lsclusters -h 2>/dev/null | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1==v && $2==c {print $4}')"
  if [[ -z "$status" ]]; then
    warn "cluster $PG_VERSION/$PG_CLUSTER tidak terdaftar"
  elif [[ "$status" == "online" ]]; then
    ok "cluster $PG_VERSION/$PG_CLUSTER online (port $(pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_CLUSTER" '$1==v && $2==c {print $3}'))"
  else
    info "menyalakan cluster $PG_VERSION/$PG_CLUSTER (status: $status)"
    if as_root pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start 2>&1 | sed 's/^/     /'; then
      sleep 1
    else
      warn "pg_ctlcluster $PG_VERSION $PG_CLUSTER start gagal — lihat /var/log/postgresql/postgresql-$PG_VERSION-$PG_CLUSTER.log"
    fi
  fi

  if ! db_ready; then
    # cluster utama rusak/tidak ada → buat cluster segar khusus AntarKita
    info "membuat cluster cadangan $PG_VERSION/$PG_FALLBACK_CLUSTER di $PG_FALLBACK_DIR (port $DB_PORT)"
    if ! pg_lsclusters -h | awk -v v="$PG_VERSION" -v c="$PG_FALLBACK_CLUSTER" '$1==v && $2==c {f=1} END {exit !f}'; then
      # bebaskan port bila cluster utama yang rusak masih mengklaimnya
      if [[ -n "$status" && "$status" != "online" ]]; then
        as_root sed -i "s/^port = .*/port = 5499/" "/etc/postgresql/$PG_VERSION/$PG_CLUSTER/postgresql.conf" || true
      fi
      as_root pg_createcluster "$PG_VERSION" "$PG_FALLBACK_CLUSTER" -d "$PG_FALLBACK_DIR" -p "$DB_PORT" \
        --locale=C.UTF-8 -- --data-checksums 2>&1 | sed 's/^/     /'
    fi
    PG_CLUSTER="$PG_FALLBACK_CLUSTER"
    as_root pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" start 2>&1 | sed 's/^/     /' || true
    sleep 1
    db_ready || die "server tetap tidak bisa dihubungi di $DB_HOST:$DB_PORT"
    ok "cluster cadangan $PG_VERSION/$PG_CLUSTER online"
  fi
}

# aktifkan trust auth untuk koneksi TCP localhost (idempoten, ditandai komentar)
ensure_trust_auth() {
  [[ "${DB_LOKAL_NO_SUDO:-0}" == "1" ]] && return
  local hba="/etc/postgresql/$PG_VERSION/$PG_CLUSTER/pg_hba.conf"
  [[ -f "$hba" ]] || { warn "pg_hba.conf tidak ditemukan di $hba — lewati"; return; }
  if as_root grep -q '^# antarkita-lokal' "$hba"; then
    ok "trust auth localhost sudah aktif di $hba"
    return
  fi
  info "mengaktifkan trust auth untuk 127.0.0.1/::1 di $hba"
  local block
  block=$'# antarkita-lokal (scripts/db-lokal.sh): trust untuk koneksi localhost — HANYA mesin uji lokal\nhost    all             all             127.0.0.1/32            trust\nhost    all             all             ::1/128                 trust\n'
  # sisipkan di atas aturan pertama yang bukan komentar agar didahulukan
  as_root cp "$hba" "$hba.bak-antarkita"
  as_root awk -v blk="$block" 'BEGIN{done=0} !done && $0 !~ /^[[:space:]]*(#|$)/ {printf "%s", blk; done=1} {print}' "$hba.bak-antarkita" \
    | as_root tee "$hba" >/dev/null
  as_root pg_ctlcluster "$PG_VERSION" "$PG_CLUSTER" reload
  ok "pg_hba.conf dimuat ulang (cadangan: $hba.bak-antarkita)"
}

# peran + database (dijalankan sebagai postgres lewat socket unix / peer)
ensure_role_db() {
  local run
  if psql -X -q -At -h "$DB_HOST" -p "$DB_PORT" -U postgres -d postgres -c 'select 1' >/dev/null 2>&1; then
    run() { psql -X -q -At -h "$DB_HOST" -p "$DB_PORT" -U postgres -d postgres "$@"; }
  else
    run() { as_pg "psql -X -q -At -p '$DB_PORT' -d postgres $(printf '%q ' "$@")"; }
  fi
  if [[ "$(run -c "select 1 from pg_roles where rolname = 'antarkita'")" != "1" ]]; then
    run -c "create role antarkita login superuser password 'antarkita'" >/dev/null
    ok "peran antarkita (superuser lokal) dibuat"
  fi
  if [[ "$DB_USER" != "postgres" && "$DB_USER" != "antarkita" ]]; then
    if [[ "$(run -c "select 1 from pg_roles where rolname = '$DB_USER'")" != "1" ]]; then
      run -c "create role \"$DB_USER\" login superuser" >/dev/null
      ok "peran $DB_USER dibuat"
    fi
  fi
  if [[ "$(run -c "select 1 from pg_database where datname = '$DB_NAME'")" != "1" ]]; then
    run -c "create database \"$DB_NAME\" owner antarkita encoding 'UTF8' template template0" >/dev/null
    ok "database $DB_NAME dibuat"
  fi
}

drop_db() {
  info "menghapus database $DB_NAME"
  psql -X -q -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB_NAME' and pid <> pg_backend_pid()" >/dev/null
  psql -X -q -d postgres -c "drop database if exists \"$DB_NAME\"" >/dev/null
}

# ---------------------------------------------------------------------
# 2. stub + 3. migrasi
# ---------------------------------------------------------------------
apply_stub() {
  [[ -f "$STUB_SQL" ]] || die "stub tidak ditemukan: $STUB_SQL"
  info "menerapkan stub Supabase ($STUB_SQL)"
  "${PSQL[@]}" -1 -f "$STUB_SQL" >"$LOG_DIR/stub.log" 2>&1 || { cat "$LOG_DIR/stub.log"; die "stub gagal"; }
  ok "stub Supabase siap (auth, storage, extensions, cron, net, supabase_realtime)"
}

migrate() {
  apply_stub
  info "menerapkan migrasi dari $MIG_DIR (urut nama berkas, satu transaksi per berkas)"
  local f name applied
  N_MIG_APPLIED=0; N_MIG_SKIPPED=0
  while IFS= read -r f; do
    name="$(basename "$f")"
    applied="$(psql -X -q -At -c "select 1 from _lokal.migrasi where nama = '$name'")"
    if [[ "$applied" == "1" ]]; then N_MIG_SKIPPED=$((N_MIG_SKIPPED+1)); continue; fi
    printf '     %s ... ' "$name"
    # fixture pra-migrasi (data produksi di luar migrasi) — transaksi yang sama, tepat sebelum migrasinya
    local pra=() pasca=()
    [[ -f "$PRA_DIR/$name" ]]   && { printf '%s[+pra]%s '   "$c_dim" "$c_off"; pra=(-f "$PRA_DIR/$name"); }
    [[ -f "$PASCA_DIR/$name" ]] && { printf '%s[+pasca]%s ' "$c_dim" "$c_off"; pasca=(-f "$PASCA_DIR/$name"); }
    if "${PSQL[@]}" -1 "${pra[@]}" -f "$f" "${pasca[@]}" >"$LOG_DIR/$name.log" 2>&1; then
      psql -X -q -c "insert into _lokal.migrasi (nama) values ('$name')" >/dev/null
      N_MIG_APPLIED=$((N_MIG_APPLIED+1)); printf '%sok%s\n' "$c_grn" "$c_off"
    else
      printf '%sGAGAL%s\n' "$c_red" "$c_off"
      grep -E 'ERROR|DETAIL|HINT|CONTEXT|LINE' "$LOG_DIR/$name.log" | head -20 | sed 's/^/       /'
      die "migrasi $name gagal — log lengkap: $LOG_DIR/$name.log"
    fi
  done < <(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | LC_ALL=C sort)
  ok "migrasi: $N_MIG_APPLIED diterapkan, $N_MIG_SKIPPED sudah ada sebelumnya"
}

# ---------------------------------------------------------------------
# 4. seed
# ---------------------------------------------------------------------
seed() {
  local force="${1:-}"
  [[ -f "$SEED_SQL" ]] || die "seed tidak ditemukan: $SEED_SQL"
  if [[ "$(psql -X -q -At -c "select 1 from _lokal.migrasi where nama = 'seed.sql'")" == "1" && "$force" != "--force" ]]; then
    SEED_RESULT="sudah pernah (lewati)"; ok "seed.sql sudah pernah diterapkan — lewati (pakai 'seed --force' atau 'reset')"; return
  fi
  info "menerapkan $SEED_SQL (app.seed_password disetel dari SEED_PASSWORD, satu transaksi)"
  # pra/seed.sql & pasca/seed.sql: penyesuaian kompatibilitas seed ↔ skema akhir (lihat komentar di berkasnya)
  local pra=() pasca=()
  [[ -f "$PRA_DIR/seed.sql" ]]   && pra=(-f "$PRA_DIR/seed.sql")
  [[ -f "$PASCA_DIR/seed.sql" ]] && pasca=(-f "$PASCA_DIR/seed.sql")
  if "${PSQL[@]}" -1 -c "set app.seed_password = '$SEED_PASSWORD'" "${pra[@]}" -f "$SEED_SQL" "${pasca[@]}" >"$LOG_DIR/seed.log" 2>&1; then
    psql -X -q -c "insert into _lokal.migrasi (nama) values ('seed.sql') on conflict do nothing" >/dev/null
    local n_users
    n_users="$(psql -X -q -At -c "select count(*) from auth.users where email like '%@antaraja.id'")"
    SEED_RESULT="ok ($n_users akun uji @antaraja.id, sandi: $SEED_PASSWORD)"
    ok "seed: $SEED_RESULT"
  else
    grep -E 'ERROR|DETAIL|HINT|CONTEXT|LINE' "$LOG_DIR/seed.log" | head -20 | sed 's/^/       /'
    SEED_RESULT="GAGAL"; die "seed gagal — log: $LOG_DIR/seed.log"
  fi
}

# ---------------------------------------------------------------------
# 5. tests
# ---------------------------------------------------------------------
# Berkas uji ada dua pola:
#   (a) blok DO yang sengaja `raise exception 'SIMULASI_SELESAI' || log` supaya
#       ROLLBACK — hasil ada di pesan error (baris "Sxx OK ..." / "Sxx BUG ...").
#   (b) begin; do $$ ... raise notice '[OK] ...' $$; rollback;  → hasil di NOTICE.
# Keduanya dijalankan tanpa ON_ERROR_STOP; kelulusan ditentukan dari isi log.
run_test() {
  local file="${1:-$E2E_SQL}"
  [[ -f "$file" ]] || die "berkas uji tidak ditemukan: $file"
  local name log; name="$(basename "$file")"; log="$LOG_DIR/test-$name.log"
  info "menjalankan uji $name (rollback otomatis; hasil di pesan RAISE)"
  PGOPTIONS="-c client_min_messages=notice" psql -X -q --pset pager=off -v ON_ERROR_STOP=0 -f "$file" >"$log" 2>&1 || true

  local n_ok n_bug n_gagal n_lewat n_dikenal=0 verdict
  n_ok="$(grep -cE '(^|[[:space:]])S[0-9]+[a-z]*[[:space:]]+OK\b|\[OK\]' "$log" || true)"
  n_gagal="$(grep -cE '\[GAGAL\]' "$log" || true)"
  n_lewat="$(grep -cE '\[LEWAT\]' "$log" || true)"
  # BUG yang sudah dikenal (scripts/db-lokal/bug-dikenal.txt) dihitung terpisah, tidak menggagalkan
  local bug_lines known_codes="" code
  bug_lines="$(grep -oE '(^|[[:space:]])S[0-9]+[a-z]*[[:space:]]+BUG\b|\[BUG\]' "$log" || true)"
  if [[ -f "$KNOWN_BUGS" ]]; then
    known_codes="$(awk -v f="$name" '$0 !~ /^[[:space:]]*(#|$)/ && $1==f {print $2}' "$KNOWN_BUGS" | tr '\n' ' ')"
  fi
  n_bug=0
  while IFS= read -r code; do
    [[ -z "$code" ]] && continue
    code="$(printf '%s' "$code" | awk '{print $1}')"
    if [[ -n "$known_codes" && " $known_codes " == *" $code "* ]]; then n_dikenal=$((n_dikenal+1)); else n_bug=$((n_bug+1)); fi
  done <<< "$bug_lines"
  local marker
  marker="$(grep -oE 'SIMULASI_SELESAI|SELESAI[A-Z_]*' "$log" | head -1 || true)"
  local other_err
  other_err="$(grep -E '^psql:.*ERROR' "$log" | grep -vE 'SIMULASI_SELESAI|\[GAGAL\]' | head -3 || true)"

  if [[ -n "$other_err" && -z "$marker" ]]; then
    verdict="GAGAL (error tak terduga)"
  elif (( n_bug > 0 || n_gagal > 0 )); then
    verdict="GAGAL"
  elif (( n_ok > 0 )); then
    verdict="LULUS"
  else
    verdict="TIDAK ADA HASIL (periksa log)"
  fi
  local line="$name: $verdict — $n_ok OK, $n_bug BUG, $n_gagal GAGAL, $n_lewat LEWAT"
  (( n_dikenal > 0 )) && line="$line, $n_dikenal BUG DIKENAL (bug-dikenal.txt)"
  line="$line${marker:+ (penanda: $marker)}"
  printf '%s\n' "$line"
  # tampilkan baris hasil (S.. OK/BUG, [OK]/[GAGAL]/[LEWAT]) supaya bisa dibaca di terminal
  grep -E '(^|[[:space:]])S[0-9]+[a-z]*[[:space:]]+(OK|BUG)\b|\[(OK|BUG|GAGAL|LEWAT)\]' "$log" | sed 's/^psql:[^:]*:[0-9]*: *//; s/^/     /' || true
  [[ -n "$other_err" ]] && { printf '     error lain:\n'; printf '%s\n' "$other_err" | sed 's/^/       /'; }
  printf '     log: %s\n' "$log"
  case "$name" in
    simulasi_e2e.sql)    E2E_RESULT="$line" ;;
    uji_idempotensi.sql) IDEMP_RESULT="$line" ;;
  esac
  [[ "$verdict" == "LULUS" ]]
}

# ---------------------------------------------------------------------
# ringkasan / status
# ---------------------------------------------------------------------
summary() {
  printf '\n%s===== RINGKASAN db-lokal =====%s\n' "$c_bold" "$c_off"
  printf 'koneksi     : postgresql://%s@%s:%s/%s\n' "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
  printf 'migrasi     : %s diterapkan sekarang, %s sudah ada, total tercatat %s dari %s berkas\n' \
    "$N_MIG_APPLIED" "$N_MIG_SKIPPED" \
    "$(psql -X -q -At -c "select count(*) from _lokal.migrasi where nama <> 'seed.sql'" 2>/dev/null || echo '?')" \
    "$(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | wc -l)"
  printf 'seed        : %s\n' "$SEED_RESULT"
  printf 'e2e         : %s\n' "$E2E_RESULT"
  printf 'idempotensi : %s\n' "$IDEMP_RESULT"
  printf 'log         : %s\n' "$LOG_DIR"
}

status() {
  ensure_cluster
  psql -X -q -c "select current_database() db, current_user usr, version()" 2>/dev/null || die "database $DB_NAME belum ada — jalankan: $0 reset"
  psql -X -q -c "select count(*) as migrasi_tercatat, max(applied_at) as terakhir from _lokal.migrasi where nama <> 'seed.sql'"
  psql -X -q -c "select (select count(*) from auth.users) as auth_users, (select count(*) from public.profiles) as profiles, (select count(*) from cron.job) as cron_jobs, (select count(*) from net._lokal_http_log) as net_calls"
}

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ---------------------------------------------------------------------
# main
# ---------------------------------------------------------------------
cmd="${1:-}"; shift || true
case "$cmd" in
  reset)
    ensure_cluster; ensure_trust_auth; ensure_role_db
    drop_db; ensure_role_db
    migrate
    seed
    set +e
    run_test "$E2E_SQL"; e2e_rc=$?
    run_test "$IDEMP_SQL"; idemp_rc=$?
    set -e
    summary
    [[ $e2e_rc -eq 0 && $idemp_rc -eq 0 ]] || exit 1
    ;;
  migrate)
    ensure_cluster; ensure_trust_auth; ensure_role_db
    migrate; summary
    ;;
  seed)
    ensure_cluster; ensure_trust_auth; ensure_role_db
    seed "${1:-}"; summary
    ;;
  test)
    ensure_cluster; ensure_trust_auth
    run_test "${1:-$E2E_SQL}"
    ;;
  psql)
    { ensure_cluster; ensure_trust_auth; } >&2   # stdout tetap bersih untuk pipa
    exec psql -X "$@"
    ;;
  status) status ;;
  -h|--help|help|"") usage 0 ;;
  *) warn "perintah tidak dikenal: $cmd"; usage 2 ;;
esac
