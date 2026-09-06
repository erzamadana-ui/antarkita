// Katalog kendaraan mitra driver — merek & model per tipe kendaraan + bahan bakar yang konsisten.
// Dipakai formulir pendaftaran driver (validasi) dan panel admin (tampilan).
export type VehicleKind = 'motor' | 'car' | 'box' | 'pickup';
export type FuelType = 'bensin' | 'diesel' | 'listrik' | 'hybrid';

export const FUEL_LABEL: Record<FuelType, string> = { bensin: 'Bensin', diesel: 'Diesel / Solar', listrik: 'Listrik (EV)', hybrid: 'Hybrid' };
export const KIND_LABEL: Record<VehicleKind, string> = { motor: 'Motor', car: 'Mobil', box: 'Mobil box / van', pickup: 'Pick up' };

/** Bahan bakar yang masuk akal per tipe kendaraan. */
export const FUEL_BY_KIND: Record<VehicleKind, FuelType[]> = {
  motor: ['bensin', 'listrik'],
  car: ['bensin', 'diesel', 'hybrid', 'listrik'],
  box: ['diesel', 'bensin', 'listrik'],
  pickup: ['diesel', 'bensin'],
};

export interface VehicleBrand { name: string; models: string[]; fuels?: Partial<Record<string, FuelType[]>> }

export const VEHICLE_CATALOG: Record<VehicleKind, VehicleBrand[]> = {
  motor: [
    { name: 'Honda', models: ['BeAT', 'Vario 125', 'Vario 160', 'Scoopy', 'PCX 160', 'Genio', 'Supra X 125', 'Revo', 'CB150R', 'EM1 e:'], fuels: { 'EM1 e:': ['listrik'] } },
    { name: 'Yamaha', models: ['NMAX', 'Aerox 155', 'Mio M3', 'Gear 125', 'FreeGo', 'Fazzio', 'Lexi', 'Jupiter Z1', 'Vixion', 'E01'], fuels: { E01: ['listrik'] } },
    { name: 'Suzuki', models: ['Nex II', 'Address', 'Burgman Street', 'Satria F150', 'GSX-R150'] },
    { name: 'Kawasaki', models: ['KLX 150', 'W175', 'Ninja 250'] },
    { name: 'Vespa', models: ['Sprint', 'Primavera', 'LX 125'] },
    { name: 'Gesits', models: ['G1', 'Raya'], fuels: { G1: ['listrik'], Raya: ['listrik'] } },
    { name: 'Polytron', models: ['Fox-R', 'Fox-S'], fuels: { 'Fox-R': ['listrik'], 'Fox-S': ['listrik'] } },
    { name: 'United', models: ['T1800', 'TX3000'], fuels: { T1800: ['listrik'], TX3000: ['listrik'] } },
    { name: 'Lainnya', models: [] },
  ],
  car: [
    { name: 'Toyota', models: ['Avanza', 'Veloz', 'Calya', 'Agya', 'Innova Reborn', 'Innova Zenix', 'Rush', 'Yaris', 'Vios', 'Raize', 'Kijang Innova (lama)', 'Fortuner', 'Alphard', 'bZ4X'], fuels: { 'Innova Reborn': ['bensin', 'diesel'], 'Innova Zenix': ['bensin', 'hybrid'], Fortuner: ['diesel', 'bensin'], bZ4X: ['listrik'] } },
    { name: 'Daihatsu', models: ['Xenia', 'Sigra', 'Ayla', 'Terios', 'Gran Max Minibus', 'Rocky', 'Luxio'] },
    { name: 'Honda', models: ['Brio', 'Mobilio', 'BR-V', 'HR-V', 'Jazz', 'City', 'Civic', 'CR-V', 'WR-V'] },
    { name: 'Mitsubishi', models: ['Xpander', 'Xpander Cross', 'Pajero Sport', 'Mirage', 'Xforce'], fuels: { 'Pajero Sport': ['diesel'] } },
    { name: 'Suzuki', models: ['Ertiga', 'XL7', 'Karimun Wagon R', 'Ignis', 'Baleno', 'APV Arena', 'S-Presso'] },
    { name: 'Nissan', models: ['Livina', 'Grand Livina', 'Serena', 'X-Trail', 'March'] },
    { name: 'Hyundai', models: ['Stargazer', 'Creta', 'Ioniq 5', 'Ioniq 6', 'Kona Electric'], fuels: { 'Ioniq 5': ['listrik'], 'Ioniq 6': ['listrik'], 'Kona Electric': ['listrik'] } },
    { name: 'Wuling', models: ['Confero', 'Cortez', 'Almaz', 'Air ev', 'BinguoEV', 'Cloud EV'], fuels: { 'Air ev': ['listrik'], BinguoEV: ['listrik'], 'Cloud EV': ['listrik'] } },
    { name: 'Kia', models: ['Carens', 'Seltos', 'Sonet', 'EV6'], fuels: { EV6: ['listrik'] } },
    { name: 'BYD', models: ['Atto 3', 'Dolphin', 'Seal', 'M6'], fuels: { 'Atto 3': ['listrik'], Dolphin: ['listrik'], Seal: ['listrik'], M6: ['listrik'] } },
    { name: 'Chery', models: ['Omoda 5', 'Tiggo 7', 'Omoda E5'], fuels: { 'Omoda E5': ['listrik'] } },
    { name: 'Isuzu', models: ['Panther', 'MU-X'], fuels: { Panther: ['diesel'], 'MU-X': ['diesel'] } },
    { name: 'Lainnya', models: [] },
  ],
  box: [
    { name: 'Daihatsu', models: ['Gran Max Blind Van', 'Gran Max Box'] },
    { name: 'Suzuki', models: ['Carry Box', 'APV Blind Van'] },
    { name: 'Toyota', models: ['Hiace Commuter', 'Hiace Premio', 'Dyna Box'], fuels: { 'Hiace Commuter': ['diesel'], 'Hiace Premio': ['diesel'], 'Dyna Box': ['diesel'] } },
    { name: 'Mitsubishi', models: ['L300 Box', 'Colt Diesel FE 71 Box', 'Colt Diesel FE 74 Box'], fuels: { 'L300 Box': ['diesel'], 'Colt Diesel FE 71 Box': ['diesel'], 'Colt Diesel FE 74 Box': ['diesel'] } },
    { name: 'Isuzu', models: ['Traga Box', 'Elf NLR Box'], fuels: { 'Traga Box': ['diesel'], 'Elf NLR Box': ['diesel'] } },
    { name: 'Hino', models: ['Dutro Box'], fuels: { 'Dutro Box': ['diesel'] } },
    { name: 'DFSK', models: ['Gelora E Blind Van'], fuels: { 'Gelora E Blind Van': ['listrik'] } },
    { name: 'Lainnya', models: [] },
  ],
  pickup: [
    { name: 'Daihatsu', models: ['Gran Max Pick Up'] },
    { name: 'Suzuki', models: ['Carry Pick Up', 'Mega Carry'] },
    { name: 'Mitsubishi', models: ['L300 Pick Up', 'Triton'], fuels: { 'L300 Pick Up': ['diesel'], Triton: ['diesel'] } },
    { name: 'Isuzu', models: ['Traga Pick Up', 'D-Max'], fuels: { 'Traga Pick Up': ['diesel'], 'D-Max': ['diesel'] } },
    { name: 'Toyota', models: ['Hilux'], fuels: { Hilux: ['diesel'] } },
    { name: 'Lainnya', models: [] },
  ],
};

export const brandsFor = (kind: VehicleKind) => VEHICLE_CATALOG[kind].map((b) => b.name);
export const modelsFor = (kind: VehicleKind, brand: string) => VEHICLE_CATALOG[kind].find((b) => b.name === brand)?.models ?? [];
/** Bahan bakar yang valid untuk kombinasi tipe/merek/model (model tertentu punya daftar khusus, mis. EV). */
export function fuelsFor(kind: VehicleKind, brand?: string | null, model?: string | null): FuelType[] {
  const b = brand ? VEHICLE_CATALOG[kind].find((x) => x.name === brand) : undefined;
  const special = model && b?.fuels?.[model];
  return (special && special.length ? special : FUEL_BY_KIND[kind]) as FuelType[];
}
/** Validasi konsistensi; mengembalikan pesan kesalahan atau null. */
export function validateVehicle(v: { kind: VehicleKind; brand: string; model?: string | null; fuel?: FuelType | null; year?: number | null }): string | null {
  if (!v.brand || v.brand.trim().length < 2) return 'Pilih merek kendaraan';
  const known = brandsFor(v.kind);
  if (v.brand !== 'Lainnya' && !known.includes(v.brand)) return `Merek ${v.brand} tidak tersedia untuk ${KIND_LABEL[v.kind].toLowerCase()} — pilih dari daftar atau "Lainnya"`;
  const models = modelsFor(v.kind, v.brand);
  if (v.brand !== 'Lainnya' && models.length > 0 && v.model && v.model !== 'Lainnya' && !models.includes(v.model)) return `Model ${v.model} bukan model ${v.brand} untuk ${KIND_LABEL[v.kind].toLowerCase()}`;
  if (!v.fuel) return 'Pilih jenis bahan bakar';
  if (!fuelsFor(v.kind, v.brand, v.model).includes(v.fuel)) return `${FUEL_LABEL[v.fuel]} tidak sesuai untuk ${v.model && v.model !== 'Lainnya' ? `${v.brand} ${v.model}` : KIND_LABEL[v.kind].toLowerCase()}`;
  if (v.year != null && (v.year < 1990 || v.year > new Date().getFullYear() + 1)) return 'Tahun kendaraan tidak valid';
  return null;
}
export const isElectricFuel = (f?: FuelType | null) => f === 'listrik';
