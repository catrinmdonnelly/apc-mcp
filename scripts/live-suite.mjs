#!/usr/bin/env node
/**
 * Live multi-scenario E2E suite.
 * Books 6 real consignments covering different services/weights/destinations,
 * fetches a label for each, then cancels every booking — even on partial failure.
 *
 * Usage:  node scripts/live-suite.mjs
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.APC_USERNAME || process.env.APC_USERNAME.includes('your-apc')) {
  console.error('✗ Set APC_USERNAME and APC_PASSWORD in .env first.');
  process.exit(1);
}
const isLive = !process.env.APC_BASE_URL?.includes('training');
if (isLive && process.env.APC_ALLOW_LIVE !== 'yes') {
  console.error('✗ Live endpoint requires APC_ALLOW_LIVE=yes in .env.');
  process.exit(1);
}

const apc = await import('../src/carriers/apc.js');

// ─── Date helpers ─────────────────────────────────────────────────────────────
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const isoDate = (d) => d.toISOString().slice(0, 10);

const today = new Date();
let nextWorkingDay = addDays(today, 1);
while (nextWorkingDay.getDay() === 0 || nextWorkingDay.getDay() === 6) {
  nextWorkingDay = addDays(nextWorkingDay, 1);
}
let nextFriday = new Date(today);
while (nextFriday.getDay() !== 5 || nextFriday <= today) nextFriday = addDays(nextFriday, 1);

const weekdayDate  = isoDate(nextWorkingDay);
const saturdayColl = isoDate(nextFriday); // collection Friday, delivery Saturday

// ─── Common sender (placeholder — override via .env for your own account) ───
const sender = {
  companyName:  process.env.TEST_SENDER_COMPANY  || 'Test Sender Ltd',
  contactName:  process.env.TEST_SENDER_NAME     || 'Test Sender',
  addressLine1: process.env.TEST_SENDER_ADDRESS1 || 'Unit 1 Test Industrial Estate',
  city:         process.env.TEST_SENDER_CITY     || 'Wrexham',
  county:       process.env.TEST_SENDER_COUNTY   || 'Clwyd',
  postcode:     process.env.TEST_SENDER_POSTCODE || 'LL13 9UT',
  phone:        process.env.TEST_SENDER_PHONE    || '01978000000',
  email:        process.env.TEST_SENDER_EMAIL    || 'sender@example.com',
};

// ─── 6 scenarios covering service variety, weight, region, multi-piece ───────
const scenarios = [
  {
    id: 'baseline-next-day',
    name: 'Standard next-day (ND16) — 2kg → Manchester',
    params: {
      service: 'next-day',
      collectionDate: weekdayDate,
      numberOfPieces: 1,
      totalWeightKg: 2,
      goodsValue: 50,
      goodsDescription: 'Test parcel',
      reference: `MCP-BASELINE-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'Recipient Ltd', contactName: 'Jane Doe',
        addressLine1: '1 High Street', city: 'Manchester', county: 'Greater Manchester',
        postcode: 'M1 1AA', phone: '07000000001',
      },
    },
  },
  {
    id: 'heavier-parcel',
    name: 'Standard next-day (ND16) — 8kg → London',
    params: {
      service: 'next-day',
      collectionDate: weekdayDate,
      numberOfPieces: 1,
      totalWeightKg: 8,
      goodsValue: 200,
      goodsDescription: 'Heavy test parcel',
      reference: `MCP-HEAVY-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'London Office Co', contactName: 'John Smith',
        addressLine1: '10 Liverpool Street', city: 'London',
        postcode: 'EC1A 1BB', phone: '07000000002',
      },
    },
  },
  {
    id: 'saturday-12',
    name: 'Saturday by 12:00 (NS12) — 1kg → Edinburgh',
    params: {
      service: 'saturday-1200',
      collectionDate: saturdayColl,
      numberOfPieces: 1,
      totalWeightKg: 1,
      goodsValue: 30,
      goodsDescription: 'Weekend test parcel',
      reference: `MCP-SAT-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'Scots Test Ltd', contactName: 'Morag MacLeod',
        addressLine1: '5 Princes Street', city: 'Edinburgh', county: 'Midlothian',
        postcode: 'EH1 1YZ', phone: '07000000003',
      },
    },
  },
  {
    id: 'multi-piece',
    name: 'Multi-piece next-day — 3 parcels, 15kg total → Cardiff',
    params: {
      service: 'next-day',
      collectionDate: weekdayDate,
      numberOfPieces: 3,
      totalWeightKg: 15,
      goodsValue: 120,
      goodsDescription: 'Multi-box test',
      reference: `MCP-MULTI-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'Cardiff Office', contactName: 'Owain Jones',
        addressLine1: '20 Queen Street', city: 'Cardiff', county: 'South Glamorgan',
        postcode: 'CF10 2BU', phone: '07000000004',
      },
    },
  },
  {
    id: 'scotland-next-day',
    name: 'Standard next-day (ND16) — 1.5kg → Glasgow',
    params: {
      service: 'next-day',
      collectionDate: weekdayDate,
      numberOfPieces: 1,
      totalWeightKg: 1.5,
      goodsValue: 25,
      goodsDescription: 'Scotland test',
      reference: `MCP-GLA-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'Glasgow Ltd', contactName: 'Fiona Campbell',
        addressLine1: '55 Buchanan Street', city: 'Glasgow',
        postcode: 'G1 3HL', phone: '07000000005',
      },
    },
  },
  {
    id: 'lightweight',
    name: 'Lightweight (LW16) — 0.5kg → Bristol',
    params: {
      service: 'next-day-light',
      collectionDate: weekdayDate,
      numberOfPieces: 1,
      totalWeightKg: 0.5,
      goodsValue: 15,
      goodsDescription: 'Light test',
      reference: `MCP-LW16-${Date.now()}`,
      sender,
      recipient: {
        companyName: 'Bristol Supplies', contactName: 'Sam Roberts',
        addressLine1: '30 Park Street', city: 'Bristol',
        postcode: 'BS1 5NT', phone: '07000000006',
      },
    },
  },
];

// ─── Run all scenarios, then cancel everything that got booked ───────────────
const results = scenarios.map(s => ({ id: s.id, name: s.name, waybill: null, booked: false, labelled: false, cancelled: false, error: null }));
const labelDir = resolve(__dirname, '../tmp');
mkdirSync(labelDir, { recursive: true });

const print = {
  head:  (n, msg) => console.log(`\n━━━ [${n}] ${msg} ━━━`),
  ok:    (msg) => console.log(`    ✓ ${msg}`),
  warn:  (msg) => console.warn(`    ⚠ ${msg}`),
  err:   (msg) => console.error(`    ✗ ${msg}`),
  info:  (msg) => console.log(`    • ${msg}`),
};

console.log(`\nRunning ${scenarios.length} scenarios on ${isLive ? 'LIVE' : 'training'}.`);
console.log(`Weekday collection: ${weekdayDate}. Saturday collection (Fri): ${saturdayColl}.\n`);

try {
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const r = results[i];

    print.head(`${i + 1}/${scenarios.length}`, s.name);

    // Book
    try {
      const bk = await apc.createConsignment(s.params);
      if (!bk.waybill) throw new Error(`No waybill. Raw: ${JSON.stringify(bk.raw)}`);
      r.waybill = bk.waybill;
      r.booked = true;
      print.ok(`Booked. WayBill: ${bk.waybill}`);
      print.info(`OrderNumber: ${bk.orderNumber} | ProductCode: ${bk.productCode}`);
      if (!bk.success) print.warn('Booking did not return SUCCESS flag — check raw response');
    } catch (e) {
      r.error = `book: ${e.message}`;
      print.err(`Booking failed: ${e.message}`);
      continue;
    }

    // Label (waits inside apc.getLabel's single request; add a small delay to be safe)
    await new Promise(res => setTimeout(res, 4000));
    try {
      const lbl = await apc.getLabel(r.waybill, 'PDF');
      if (!lbl.labelBase64) throw new Error('no base64 content');
      const buf = Buffer.from(lbl.labelBase64, 'base64');
      const outPath = resolve(labelDir, `${s.id}-${r.waybill}.pdf`);
      writeFileSync(outPath, buf);
      r.labelled = true;
      print.ok(`Label saved: ${outPath.split('/').pop()} (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      r.error = `label: ${e.message}`;
      print.err(`Label fetch failed: ${e.message}`);
    }

    // Brief pause between scenarios
    await new Promise(res => setTimeout(res, 1000));
  }
} finally {
  // ─── Always cancel everything that booked ──────────────────────────────────
  console.log('\n━━━ Cleanup: cancelling every booked waybill ━━━');
  for (const r of results) {
    if (!r.waybill) continue;
    try {
      const cn = await apc.cancelConsignment(r.waybill);
      if (cn.success) {
        r.cancelled = true;
        print.ok(`Cancelled ${r.waybill} (${r.id})`);
      } else {
        print.err(`Cancel response not confirmed for ${r.waybill}: ${cn.message}`);
        print.err(`⚠  MANUALLY CANCEL IN APC PORTAL: ${r.waybill}`);
        r.error = (r.error ? r.error + ' | ' : '') + `cancel: ${cn.message}`;
      }
    } catch (e) {
      print.err(`Cancel failed for ${r.waybill}: ${e.message}`);
      print.err(`⚠  MANUALLY CANCEL IN APC PORTAL: ${r.waybill}`);
      r.error = (r.error ? r.error + ' | ' : '') + `cancel: ${e.message}`;
    }
    await new Promise(res => setTimeout(res, 500));
  }
}

// ─── Summary table ──────────────────────────────────────────────────────────
console.log('\n━━━ Summary ━━━');
const col = (s, w) => (s + ' '.repeat(w)).slice(0, w);
console.log(col('scenario', 28), col('book', 6), col('label', 6), col('cancel', 7), 'waybill / error');
console.log('─'.repeat(90));
let pass = 0, fail = 0;
for (const r of results) {
  const b = r.booked    ? '✓' : '✗';
  const l = r.labelled  ? '✓' : '✗';
  const c = r.cancelled ? '✓' : (r.waybill ? '✗' : '—');
  const tail = r.cancelled && !r.error ? r.waybill : (r.error || r.waybill || '(not booked)');
  console.log(col(r.id, 28), col(b, 6), col(l, 6), col(c, 7), tail);
  if (r.booked && r.labelled && r.cancelled && !r.error) pass++; else fail++;
}
console.log('─'.repeat(90));
console.log(`${pass}/${scenarios.length} scenarios passed cleanly. ${fail} with issues.`);

const uncancelled = results.filter(r => r.waybill && !r.cancelled);
if (uncancelled.length > 0) {
  console.error(`\n⚠⚠⚠ ${uncancelled.length} consignment(s) NOT cancelled — log in to APC portal now:`);
  for (const r of uncancelled) console.error(`   - ${r.waybill}  (${r.id})`);
  process.exit(1);
}

console.log('\nAll labels in: tmp/\n');
process.exit(fail > 0 ? 1 : 0);
