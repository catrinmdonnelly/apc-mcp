#!/usr/bin/env node
/**
 * Live E2E test — runs the full APC MCP workflow against the training endpoint.
 * Credentials read from .env. Not published to npm (scripts/ is outside the files array).
 *
 * Usage:  node scripts/live.mjs
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
  console.error('✗ Safety check: APC_BASE_URL is pointed at LIVE, but APC_ALLOW_LIVE=yes is not set.');
  console.error('  Set APC_ALLOW_LIVE=yes in .env to confirm you understand this books (and then cancels) a real consignment.');
  process.exit(1);
}
if (isLive) {
  console.log('⚠  LIVE MODE: this will book a real consignment and cancel it immediately.');
  console.log('   Cancellation is only effective before the parcel is manifested by APC.');
  console.log('   The script uses try/finally so cancel ALWAYS runs, even if other steps fail.\n');
}

const apc = await import('../src/carriers/apc.js');

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const collectionDate = tomorrow.toISOString().slice(0, 10);

const testShipment = {
  service: 'next-day',
  collectionDate,
  numberOfPieces: 1,
  totalWeightKg: 2,
  itemType: 'PARCEL',
  goodsValue: 50,
  goodsDescription: 'Test parcel - MCP E2E',
  reference: `MCP-TEST-${Date.now()}`,
  sender: {
    companyName:  'CLIR AI',
    contactName:  'Catrin Donnelly',
    addressLine1: 'National Sortation Centre',
    addressLine2: 'Kingswood Lakeside',
    city:         'Cannock',
    county:       'Staffordshire',
    postcode:     'WS11 8LD',
    phone:        '01922702587',
    email:        'test@example.com',
  },
  recipient: {
    companyName:  'Test Recipient Ltd',
    contactName:  'Jane Doe',
    addressLine1: '1 High Street',
    city:         'Manchester',
    county:       'Greater Manchester',
    postcode:     'M1 1AA',
    phone:        '07000000000',
    email:        'recipient@example.com',
    instructions: 'Leave with neighbour',
  },
};

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok   = (msg) => console.log(`    ✓ ${msg}`);
const warn = (msg) => console.warn(`    ⚠ ${msg}`);
const err  = (msg) => console.error(`    ✗ ${msg}`);

let waybill;
const errors = [];

try {
  // ── 1. Book ─────────────────────────────────────────────────────────────────
  step(1, `Booking a test shipment on ${isLive ? 'LIVE' : 'training'} endpoint...`);
  try {
    const result = await apc.createConsignment(testShipment);
    if (!result.waybill) throw new Error(`No waybill in response. Raw: ${JSON.stringify(result.raw, null, 2)}`);
    waybill = result.waybill;
    ok(`Booked. WayBill: ${waybill}`);
    ok(`OrderNumber: ${result.orderNumber}`);
    ok(`ProductCode: ${result.productCode}`);
    if (!result.success) warn(`Success flag not set — the API may have returned a partial success. Check raw:\n${JSON.stringify(result.raw, null, 2)}`);
  } catch (e) {
    err(`Booking failed: ${e.message}`);
    errors.push(`book: ${e.message}`);
    throw e;
  }

  // ── 2. Wait, then fetch label ───────────────────────────────────────────────
  step(2, 'Waiting 5 seconds for label generation...');
  await new Promise((r) => setTimeout(r, 5000));

  step('2b', 'Fetching PDF label...');
  try {
    const label = await apc.getLabel(waybill, 'PDF');
    if (!label.labelBase64) throw new Error('Label returned but no base64 content');
    const buf = Buffer.from(label.labelBase64, 'base64');
    const outDir = resolve(__dirname, '../tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, `label-${waybill}.pdf`);
    writeFileSync(outPath, buf);
    ok(`Label saved: ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
  } catch (e) {
    err(`Label fetch failed: ${e.message}`);
    errors.push(`label: ${e.message}`);
  }

  // ── 3. Track ────────────────────────────────────────────────────────────────
  step(3, 'Tracking the shipment...');
  try {
    const track = await apc.trackConsignment(waybill);
    ok(`Status: ${track.status}`);
    ok(`Events: ${track.events.length}`);
  } catch (e) {
    warn(`Track not yet available for fresh bookings: ${e.message}`);
  }
} finally {
  // ── 4. Cancel — ALWAYS RUNS, even on earlier failures ───────────────────────
  if (waybill) {
    step(4, `Cancelling ${waybill}...`);
    try {
      const cancel = await apc.cancelConsignment(waybill);
      if (cancel.success) {
        ok(`Cancelled: ${cancel.message}`);
      } else {
        err(`Cancel response did not confirm success: ${cancel.message}`);
        err(`Raw: ${JSON.stringify(cancel.raw, null, 2)}`);
        err(`⚠  MANUALLY CANCEL VIA APC PORTAL: waybill ${waybill}`);
        errors.push(`cancel: ${cancel.message}`);
      }
    } catch (e) {
      err(`Cancel failed: ${e.message}`);
      err(`⚠  MANUALLY CANCEL VIA APC PORTAL: waybill ${waybill}`);
      errors.push(`cancel: ${e.message}`);
    }
  } else {
    console.log('\n(No waybill was created, nothing to cancel.)');
  }
}

if (errors.length === 0) {
  console.log('\n✓ Full end-to-end flow passed. APC MCP is working.\n');
  process.exit(0);
} else {
  console.error(`\n✗ ${errors.length} step(s) failed:`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
