#!/usr/bin/env node
/**
 * Live E2E test for book_batch_and_label — books 2 test shipments on APC,
 * gets their labels, merges them into one PDF, then cancels both.
 *
 * Usage:  node scripts/live-batch.mjs
 *
 * Safety:
 *   - If APC_BASE_URL points at LIVE (not training), requires APC_ALLOW_LIVE=yes.
 *   - Uses try/finally so cancels ALWAYS run, even on failure.
 */

import { readFileSync, existsSync } from 'fs';
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
  process.exit(1);
}
if (isLive) {
  console.log('⚠  LIVE MODE: this will book TWO real consignments and cancel them immediately.\n');
}

// Route merged PDFs to a temp dir to avoid cluttering ~/Downloads during testing.
import { tmpdir } from 'os';
import { join } from 'path';
process.env.PARCEL_TOOLKIT_LABELS_DIR = join(tmpdir(), `apc-batch-test-${Date.now()}`);

const apc = await import('../src/carriers/apc.js');
const { mergeLabelsToPdf, saveLabelToDisk, timestamp } = await import('../src/utils/labels.js');
const { PDFDocument } = await import('pdf-lib');

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const collectionDate = tomorrow.toISOString().slice(0, 10);

const sender = {
  companyName:  'Test Sender Ltd',
  contactName:  'Test Sender',
  addressLine1: 'Unit 1 Test Industrial Estate',
  city:         'Wrexham',
  county:       'Clwyd',
  postcode:     'LL13 9UT',
  phone:        '01978000000',
  email:        'sender@example.com',
};

const shipments = [
  {
    numberOfPieces: 1,
    totalWeightKg: 2,
    itemType: 'PARCEL',
    goodsDescription: 'Batch test #1',
    reference: `MCP-BATCH-${Date.now()}-1`,
    recipient: {
      companyName:  'Batch Test Recipient 1 Ltd',
      contactName:  'Alice Smith',
      addressLine1: '1 High Street',
      city:         'Manchester',
      county:       'Greater Manchester',
      postcode:     'M1 1AA',
      phone:        '07000000001',
      email:        'alice@example.com',
    },
  },
  {
    numberOfPieces: 1,
    totalWeightKg: 1.5,
    itemType: 'PARCEL',
    goodsDescription: 'Batch test #2',
    reference: `MCP-BATCH-${Date.now()}-2`,
    recipient: {
      companyName:  'Batch Test Recipient 2 Ltd',
      contactName:  'Bob Jones',
      addressLine1: '2 Church Road',
      city:         'Bristol',
      county:       'Bristol',
      postcode:     'BS1 1AA',
      phone:        '07000000002',
      email:        'bob@example.com',
    },
  },
];

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok   = (msg) => console.log(`    ✓ ${msg}`);
const err  = (msg) => console.error(`    ✗ ${msg}`);

const waybills = [];
const errors = [];

try {
  // ── 1. Book each shipment ─────────────────────────────────────────────────
  step(1, `Booking ${shipments.length} test shipments on ${isLive ? 'LIVE' : 'training'} endpoint...`);
  for (let i = 0; i < shipments.length; i++) {
    const s = shipments[i];
    try {
      const result = await apc.createConsignment({
        service: 'next-day',
        collectionDate,
        sender,
        recipient: s.recipient,
        numberOfPieces: s.numberOfPieces,
        totalWeightKg: s.totalWeightKg,
        itemType: s.itemType,
        goodsDescription: s.goodsDescription,
        reference: s.reference,
      });
      if (!result.waybill) throw new Error(`No waybill. Raw: ${JSON.stringify(result.raw)}`);
      waybills.push(result.waybill);
      ok(`Shipment ${i + 1}: ${result.waybill} (${s.recipient.contactName}, ${s.recipient.postcode})`);
    } catch (e) {
      err(`Shipment ${i + 1} booking failed: ${e.message}`);
      errors.push(`book#${i + 1}: ${e.message}`);
    }
  }

  if (waybills.length === 0) throw new Error('No shipments booked — aborting.');

  // ── 2. Fetch labels ───────────────────────────────────────────────────────
  step(2, `Fetching labels for ${waybills.length} waybills...`);
  const labelsBase64 = [];
  for (const waybill of waybills) {
    try {
      const label = await apc.getLabel(waybill, 'PDF');
      if (!label.labelBase64) throw new Error('No label content returned');
      labelsBase64.push(label.labelBase64);
      ok(`Label fetched for ${waybill} (${(Buffer.from(label.labelBase64, 'base64').length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      err(`Label fetch failed for ${waybill}: ${e.message}`);
      errors.push(`label#${waybill}: ${e.message}`);
    }
  }

  if (labelsBase64.length === 0) throw new Error('No labels fetched — aborting merge test.');

  // ── 3. Save one individually ──────────────────────────────────────────────
  step(3, 'Saving a single label to disk (testing saveLabelToDisk)...');
  try {
    const singlePath = await saveLabelToDisk({
      labelBase64: labelsBase64[0],
      filenameStem: `apc-${waybills[0]}-${timestamp()}`,
      extension: 'pdf',
    });
    const singleDoc = await PDFDocument.load(readFileSync(singlePath));
    ok(`Saved: ${singlePath} (${singleDoc.getPageCount()} page(s), ${readFileSync(singlePath).length} bytes)`);
  } catch (e) {
    err(`Single save failed: ${e.message}`);
    errors.push(`single-save: ${e.message}`);
  }

  // ── 4. Merge all labels ──────────────────────────────────────────────────
  step(4, `Merging ${labelsBase64.length} labels into one PDF...`);
  try {
    const mergedPath = await mergeLabelsToPdf({
      labelsBase64,
      filenameStem: `apc-batch-${timestamp()}-${labelsBase64.length}labels`,
    });
    const mergedDoc = await PDFDocument.load(readFileSync(mergedPath));
    const pageCount = mergedDoc.getPageCount();
    ok(`Merged PDF: ${mergedPath}`);
    ok(`Pages: ${pageCount} (expected >= ${labelsBase64.length})`);
    ok(`Size: ${readFileSync(mergedPath).length} bytes`);
    if (pageCount < labelsBase64.length) {
      errors.push(`merge: expected at least ${labelsBase64.length} pages, got ${pageCount}`);
    }
  } catch (e) {
    err(`Merge failed: ${e.message}`);
    errors.push(`merge: ${e.message}`);
  }
} finally {
  // ── 5. Cancel all waybills ───────────────────────────────────────────────
  if (waybills.length) {
    step(5, `Cancelling ${waybills.length} waybills...`);
    for (const waybill of waybills) {
      try {
        const cancel = await apc.cancelConsignment(waybill);
        if (cancel.success) {
          ok(`Cancelled ${waybill}: ${cancel.message}`);
        } else {
          err(`Cancel not confirmed for ${waybill}: ${cancel.message}`);
          err(`⚠  MANUALLY CANCEL VIA APC PORTAL: ${waybill}`);
          errors.push(`cancel#${waybill}: ${cancel.message}`);
        }
      } catch (e) {
        err(`Cancel failed for ${waybill}: ${e.message}`);
        err(`⚠  MANUALLY CANCEL VIA APC PORTAL: ${waybill}`);
        errors.push(`cancel#${waybill}: ${e.message}`);
      }
    }
  }
}

if (errors.length === 0) {
  console.log('\n✓ Batch flow passed. book_batch_and_label is working.\n');
  process.exit(0);
} else {
  console.error(`\n✗ ${errors.length} step(s) failed:`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
