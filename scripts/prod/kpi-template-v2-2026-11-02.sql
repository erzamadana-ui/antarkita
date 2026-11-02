-- Template target KPI Manager Kota v2 (SDM, 2 Nov 2026) — keputusan GM: gaji pokok 15 jt; target menutup biaya kota.
-- Dijalankan di produksi 2 Nov 2026. Idempoten (upsert).
insert into public.kpi_target_templates (tier, month_no, target_merchant_new, target_driver_new, target_merchant_active, target_driver_active, target_orders, weight_merchant_new, weight_driver_new, weight_active, weight_orders, bonus_pool, note) values
(1,1,35,64,21,38,760,35,35,15,15,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(1,2,56,102,52,95,1890,35,35,15,15,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(1,3,79,141,94,170,3400,30,30,20,20,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(1,4,84,155,135,246,4910,30,30,20,20,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(1,5,93,166,177,321,6420,20,20,25,35,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(1,6,82,149,208,378,7550,20,20,25,35,2000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,1,27,50,16,30,590,35,35,15,15,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,2,45,79,41,74,1480,35,35,15,15,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,3,61,111,73,133,2660,30,30,20,20,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,4,68,121,106,192,3840,30,30,20,20,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,5,71,131,138,251,5020,20,20,25,35,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(2,6,63,116,162,295,5900,20,20,25,35,1500000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,1,22,39,13,23,460,35,35,15,15,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,2,34,63,32,58,1150,35,35,15,15,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,3,47,87,57,104,2070,30,30,20,20,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,4,52,94,82,150,2990,30,30,20,20,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,5,57,102,108,196,3910,20,20,25,35,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)'),
(3,6,50,90,127,230,4600,20,20,25,35,1000000,'SDM v2 2 Nov 2026 (break-even NPR 5.422; ASUMSI)')
on conflict (tier, month_no) do update set target_merchant_new=excluded.target_merchant_new, target_driver_new=excluded.target_driver_new, target_merchant_active=excluded.target_merchant_active, target_driver_active=excluded.target_driver_active, target_orders=excluded.target_orders, weight_merchant_new=excluded.weight_merchant_new, weight_driver_new=excluded.weight_driver_new, weight_active=excluded.weight_active, weight_orders=excluded.weight_orders, bonus_pool=excluded.bonus_pool, note=excluded.note, updated_at=now();
