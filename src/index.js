#!/usr/bin/env node
/**
 * APC Overnight MCP Server
 *
 * Connects any MCP-compatible AI (Claude, Cursor, etc.) to APC Overnight's
 * New Horizon API for booking, labelling, tracking and cancelling UK parcels.
 *
 * Usage: node src/index.js  (or: npx apc-mcp)
 * Config: copy .env.example to .env and add your APC_USERNAME / APC_PASSWORD
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as apc from './carriers/apc.js';
import { saveLabelToDisk, mergeLabelsTolerant, recordBooking, safeExtension, timestamp } from './utils/labels.js';
import { cleanText } from './utils/text.js';

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) {
      // Settings passed in by the MCP client win over this file.
      if (process.env[key.trim()] === undefined) {
        process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

const server = new McpServer({
  name: 'apc-mcp',
  version: '0.2.1',
});

const addressSchema = z.object({
  companyName:   z.string().optional().describe('Company name (optional for collection if using account address)'),
  contactName:   z.string().describe('Contact person name'),
  addressLine1:  z.string().describe('First line of address'),
  addressLine2:  z.string().optional().describe('Second line of address (optional)'),
  city:          z.string().describe('Town or city'),
  county:        z.string().optional().describe('County (optional)'),
  postcode:      z.string().describe('UK postcode. Include the space e.g. WS11 8LD'),
  phone:         z.string().describe('Phone number'),
  mobilePhone:   z.string().optional().describe('Mobile number for delivery notifications (optional)'),
  email:         z.string().optional().describe('Email address (optional)'),
  instructions:  z.string().optional().describe('Delivery instructions e.g. leave with neighbour (recipient only)'),
});

server.tool(
  'book_shipment',
  'Book a parcel delivery with APC Overnight. Returns a 22-digit waybill used for label retrieval and tracking.',
  {
    service: z.string().describe(
      'APC delivery service. Pass a friendly key (e.g. "next-day", "saturday-1200", ' +
      '"courier-pack", "liquid-0900", "ireland-road") or the raw ProductCode (e.g. "ND16", ' +
      '"NS12", "CP16", "LP09", "ROAD"). Call list_services for the full catalogue. ' +
      'Required: ask which service is wanted rather than guessing.'
    ),

    collectionDate: z.string().describe('Collection date. YYYY-MM-DD or DD/MM/YYYY'),

    readyAt:   z.string().optional().describe('Time goods will be ready HH:MM (default 09:00)'),
    closedAt:  z.string().optional().describe('Time business closes HH:MM (default 17:00)'),

    numberOfPieces: z.number().int().min(1).max(50).describe('Number of parcels/items in this consignment (1 to 50)'),
    totalWeightKg:  z.number().positive().max(2000).describe('Total weight in kg'),

    itemType: z.enum(['PARCEL', 'PACK', 'LIQUIDS', 'LIMITED QUANTITIES'])
      .default('PARCEL')
      .describe('Type of goods being sent'),

    goodsValue: z.number().optional().describe('Declared value in GBP'),
    goodsDescription: z.string().optional().describe('Brief description of goods'),

    sender:    addressSchema.describe('Sender / collection address'),
    recipient: addressSchema.describe('Recipient / delivery address'),

    reference: z.string().optional().describe('Your internal order or job reference'),
  },
  { title: 'Book an APC shipment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async (params) => {
    try {
      const result = await apc.createConsignment(params);
      if (!result.success) {
        return {
          content: [{ type: 'text', text: `APC did not confirm the booking${result.message ? `: ${result.message}` : '.'}` }],
          isError: true,
        };
      }
      await recordBooking({ carrier: 'APC', waybill: result.waybill, recipient: `${params.recipient.contactName}, ${params.recipient.postcode}`, reference: params.reference || null });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            carrier: 'APC Overnight',
            waybill: result.waybill,
            orderNumber: result.orderNumber,
            productCode: result.productCode,
            collectionDate: params.collectionDate,
            service: params.service,
            pieces: params.numberOfPieces,
            weightKg: params.totalWeightKg,
            recipient: `${params.recipient.contactName}, ${params.recipient.postcode}`,
            warning: result.message && result.message !== 'SUCCESS' ? result.message : undefined,
            note: 'Wait 3-5 seconds before calling get_label with the waybill.',
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error booking shipment: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'get_label',
  'Get the shipping label for a booked APC consignment and save it to disk. Call any time after book_shipment. APC typically needs 3-5 seconds to generate it, which this tool waits for automatically. APC marks the consignment as printed once the label has been fetched. Returns the local file path. Default save location is ~/Downloads/parcel-toolkit/, overridable via the PARCEL_TOOLKIT_LABELS_DIR env var.',
  {
    waybill: z.string().describe('The 22-digit WayBill number returned when booking (or from a previously booked consignment).'),
    format:  z.enum(['PDF', 'ZPL', 'PNG']).default('PDF').describe('Label format. PDF for standard printers, ZPL for thermal (Zebra/Rollo), PNG for previews.'),
  },
  { title: 'Get an APC shipping label', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ waybill, format }) => {
    try {
      const result = await apc.getLabel(waybill, format);
      const extension = safeExtension(result.format, format.toLowerCase());
      const filePath = await saveLabelToDisk({
        labelBase64: result.labelBase64,
        filenameStem: `apc-${waybill}-${timestamp()}`,
        extension,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            waybill,
            format: result.format,
            filePath,
            message: `Label saved to ${filePath}. Open or drag the file to print.`,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error getting label: ${err.message}` }],
        isError: true,
      };
    }
  }
);

const perShipmentSchema = z.object({
  numberOfPieces: z.number().int().min(1).max(50).describe('Number of parcels/items for this shipment (1 to 50)'),
  totalWeightKg:  z.number().positive().max(2000).describe('Total weight in kg for this shipment'),
  itemType: z.enum(['PARCEL', 'PACK', 'LIQUIDS', 'LIMITED QUANTITIES']).default('PARCEL'),
  goodsValue: z.number().optional().describe('Declared value in GBP'),
  goodsDescription: z.string().optional().describe('Brief description of goods'),
  recipient: addressSchema.describe('Recipient / delivery address for this shipment'),
  reference: z.string().optional().describe('Internal order reference for this shipment'),
});

server.tool(
  'book_batch_and_label',
  'Book multiple APC shipments at once (up to 50), then fetch the labels. Every shipment booked costs money. PDF labels are merged into one file, ready to print; ZPL and PNG labels are saved as one file each. Use this when the user pastes a list of orders/addresses. All shipments share the same service, collection date and sender. A shipment that is booked but whose label could not be fetched is still reported with its waybill, so never book it again; use get_label instead. Saves to ~/Downloads/parcel-toolkit/ (overridable via PARCEL_TOOLKIT_LABELS_DIR).',
  {
    service: z.string().describe('APC delivery service for every shipment in this batch (e.g. "next-day", "next-day-1200", "ND16"). Call list_services for the full catalogue.'),
    collectionDate: z.string().describe('Collection date for every shipment. YYYY-MM-DD or DD/MM/YYYY'),
    readyAt:  z.string().optional().describe('Time goods will be ready HH:MM (default 09:00)'),
    closedAt: z.string().optional().describe('Time business closes HH:MM (default 17:00)'),
    sender:   addressSchema.describe('Sender / collection address. Same for every shipment in the batch.'),
    shipments: z.array(perShipmentSchema).min(1).max(50).describe('Array of shipments to book, at most 50. Each entry is one consignment with its own recipient, weight and pieces.'),
    labelFormat: z.enum(['PDF', 'ZPL', 'PNG']).default('PDF').describe('Label format. PDF labels are merged into one file. ZPL (thermal printers) and PNG labels are saved as one file per shipment.'),
  },
  { title: 'Book several APC shipments and print their labels', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async (params) => {
    const { service, collectionDate, readyAt, closedAt, sender, shipments, labelFormat } = params;

    // Step 1: book every shipment. Nothing after this may hide a booking that has been made.
    const booked = [];
    const failures = [];

    for (let i = 0; i < shipments.length; i++) {
      const s = shipments[i];
      const recipient = `${s.recipient.contactName}, ${s.recipient.postcode}`;
      try {
        const result = await apc.createConsignment({
          service,
          collectionDate,
          readyAt,
          closedAt,
          numberOfPieces: s.numberOfPieces,
          totalWeightKg:  s.totalWeightKg,
          itemType: s.itemType,
          goodsValue: s.goodsValue,
          goodsDescription: s.goodsDescription,
          sender,
          recipient: s.recipient,
          reference: s.reference,
        });
        if (!result.success || !result.waybill) {
          throw new Error(result.message || 'APC did not confirm the booking.');
        }
        booked.push({
          index: i + 1,
          recipient,
          waybill: result.waybill,
          orderNumber: result.orderNumber,
          reference: s.reference || null,
        });
        await recordBooking({ carrier: 'APC', waybill: result.waybill, recipient, reference: s.reference || null });
      } catch (err) {
        failures.push({ index: i + 1, recipient, error: cleanText(err.message, 300) });
      }
    }

    if (booked.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            booked: 0,
            failed: failures.length,
            failures,
            message: 'Nothing was booked. See failures for details.',
          }, null, 2),
        }],
        isError: true,
      };
    }

    // Step 2: fetch the labels. A label that cannot be fetched leaves the booking in place.
    const labels = [];
    for (const entry of booked) {
      try {
        labels.push({ entry, label: await apc.getLabel(entry.waybill, labelFormat) });
      } catch (err) {
        entry.labelError = cleanText(err.message, 300);
      }
    }

    // Step 3: save them. PDFs become one file, other formats stay one file per shipment.
    let mergedPdfPath;
    let mergeError;
    if (labels.length > 0 && labelFormat === 'PDF') {
      try {
        const merge = await mergeLabelsTolerant({
          labels: labels.map(({ entry, label }) => ({ id: entry.waybill, labelBase64: label.labelBase64 })),
          filenameStem: `apc-batch-${timestamp()}-${labels.length}labels`,
        });
        mergedPdfPath = merge.path;
        for (const { id, error } of merge.skipped) {
          const entry = booked.find((b) => b.waybill === id);
          if (entry) entry.labelError = error;
        }
      } catch (err) {
        mergeError = cleanText(err.message, 300);
      }
    } else {
      for (const { entry, label } of labels) {
        try {
          entry.labelFile = await saveLabelToDisk({
            labelBase64: label.labelBase64,
            filenameStem: `apc-${entry.waybill}-${timestamp()}`,
            extension: safeExtension(label.format, labelFormat.toLowerCase()),
          });
        } catch (err) {
          entry.labelError = cleanText(err.message, 300);
        }
      }
    }

    const withoutLabel = booked.filter((b) => (mergeError ? true : (labelFormat === 'PDF' ? b.labelError : !b.labelFile)));
    const bookingsFile = 'bookings.jsonl in the labels folder';
    const parts = [`Booked ${booked.length} of ${shipments.length} shipments. Each booking is also written to ${bookingsFile}.`];
    if (mergedPdfPath) parts.push(`Merged PDF saved to ${mergedPdfPath}.`);
    if (withoutLabel.length > 0) {
      parts.push(
        `${withoutLabel.length} booked shipment${withoutLabel.length === 1 ? ' has' : 's have'} no saved label yet. ` +
        `They are booked, so do not book them again. Call get_label with each waybill to try again.`
      );
    }
    if (failures.length > 0) {
      parts.push(`${failures.length} shipment${failures.length === 1 ? ' was' : 's were'} not booked. If an error says the booking may still have gone through, check your APC account before booking it again, because no waybill came back to track.`);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          carrier: 'APC Overnight',
          service,
          collectionDate,
          booked: booked.length,
          failed: failures.length,
          shipments: booked,
          failures: failures.length ? failures : undefined,
          mergedPdfPath,
          mergeError,
          message: parts.join(' '),
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'track_shipment',
  'Get the current status and tracking history for an APC Overnight consignment.',
  {
    waybill: z.string().describe('The 22-digit WayBill number'),
  },
  { title: 'Track an APC shipment', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  async ({ waybill }) => {
    try {
      const result = await apc.trackConsignment(waybill);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            waybill,
            status: result.status,
            events: result.events,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error tracking shipment: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'cancel_shipment',
  'Cancel an APC Overnight consignment. Must be done before the parcel is collected/manifested.',
  {
    waybill: z.string().describe('The 22-digit WayBill number to cancel'),
  },
  { title: 'Cancel an APC shipment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async ({ waybill }) => {
    try {
      const result = await apc.cancelConsignment(waybill);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            waybill,
            message: result.message,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error cancelling shipment: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  'list_services',
  'List every APC Overnight delivery service with friendly key, label and ProductCode. Service availability depends on your APC account and routing, so confirm with your depot before relying on an unusual service.',
  {},
  { title: 'List APC services', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async () => ({
    content: [{
      type: 'text',
      text: JSON.stringify({
        carrier: 'APC Overnight',
        services: [
          // Weekday parcel
          { key: 'next-day',                        label: 'Next Day Parcel by 16:00',           code: 'ND16' },
          { key: 'next-day-1200',                   label: 'Next Day Parcel by 12:00',           code: 'ND12' },
          { key: 'next-day-1000',                   label: 'Next Day Parcel by 10:00',           code: 'ND10' },
          { key: 'next-day-0900',                   label: 'Next Day Parcel by 09:00',           code: 'ND09' },
          { key: 'two-five-day',                    label: '2-5 Day Parcel (economy)',           code: 'TDAY' },
          // Weekday lightweight
          { key: 'next-day-light',                  label: 'Next Day Lightweight by 16:00',      code: 'LW16' },
          { key: 'next-day-light-1200',             label: 'Next Day Lightweight by 12:00',      code: 'LW12' },
          { key: 'next-day-light-1000',             label: 'Next Day Lightweight by 10:00',      code: 'LW10' },
          { key: 'next-day-light-0900',             label: 'Next Day Lightweight by 09:00',      code: 'LW09' },
          { key: 'two-five-day-light',              label: '2-5 Day Lightweight',                code: 'TDLW' },
          // Weekday courier pack (pre-printed, up to 5kg)
          { key: 'courier-pack',                    label: 'Next Day Courier Pack by 16:00',     code: 'CP16' },
          { key: 'courier-pack-1200',               label: 'Next Day Courier Pack by 12:00',     code: 'CP12' },
          { key: 'courier-pack-1000',               label: 'Next Day Courier Pack by 10:00',     code: 'CP10' },
          { key: 'courier-pack-0900',               label: 'Next Day Courier Pack by 09:00',     code: 'CP09' },
          { key: 'two-five-day-courier-pack',       label: '2-5 Day Courier Pack',               code: 'TDCP' },
          // Weekday mail pack (pre-printed, up to 1kg)
          { key: 'mail-pack',                       label: 'Next Day Mail Pack by 16:00',        code: 'MP16' },
          { key: 'mail-pack-1200',                  label: 'Next Day Mail Pack by 12:00',        code: 'MP12' },
          { key: 'mail-pack-1000',                  label: 'Next Day Mail Pack by 10:00',        code: 'MP10' },
          { key: 'mail-pack-0900',                  label: 'Next Day Mail Pack by 09:00',        code: 'MP09' },
          { key: 'two-five-day-mail-pack',          label: '2-5 Day Mail Pack',                  code: 'TDMP' },
          // Weekday liquid
          { key: 'liquid',                          label: 'Next Day Liquid Product by 16:00',   code: 'LP16' },
          { key: 'liquid-1200',                     label: 'Next Day Liquid Product by 12:00',   code: 'LP12' },
          { key: 'liquid-1000',                     label: 'Next Day Liquid Product by 10:00',   code: 'LP10' },
          { key: 'liquid-0900',                     label: 'Next Day Liquid Product by 09:00',   code: 'LP09' },
          { key: 'two-five-day-liquid',             label: '2-5 Day Liquid Product',             code: 'TDLP' },
          // Weekday limited quantity (DG under LQ exemption)
          { key: 'limited-quantity',                label: 'Next Day Limited Quantity by 16:00', code: 'LQ16' },
          { key: 'limited-quantity-1200',           label: 'Next Day Limited Quantity by 12:00', code: 'LQ12' },
          { key: 'limited-quantity-1000',           label: 'Next Day Limited Quantity by 10:00', code: 'LQ10' },
          { key: 'limited-quantity-0900',           label: 'Next Day Limited Quantity by 09:00', code: 'LQ09' },
          // Weekday non-conveyable
          { key: 'non-conveyable',                  label: 'Next Day Non-Conveyable by 16:00',   code: 'NC16' },
          { key: 'non-conveyable-1200',             label: 'Next Day Non-Conveyable by 12:00',   code: 'NC12' },
          { key: 'non-conveyable-1000',             label: 'Next Day Non-Conveyable by 10:00',   code: 'NC10' },
          { key: 'non-conveyable-0900',             label: 'Next Day Non-Conveyable by 09:00',   code: 'NC09' },
          { key: 'two-five-day-non-conveyable',     label: '2-5 Day Non-Conveyable',             code: 'TDNC' },
          // Weekday excess
          { key: 'excess',                          label: 'Next Day Excess Parcel by 16:00',    code: 'XS16' },
          { key: 'excess-1200',                     label: 'Next Day Excess Parcel by 12:00',    code: 'XS12' },
          { key: 'excess-1000',                     label: 'Next Day Excess Parcel by 10:00',    code: 'XS10' },
          { key: 'excess-0900',                     label: 'Next Day Excess Parcel by 09:00',    code: 'XS09' },
          // Saturday parcel
          { key: 'saturday-1200',                   label: 'Saturday Parcel by 12:00',           code: 'NS12' },
          { key: 'saturday-1000',                   label: 'Saturday Parcel by 10:00',           code: 'NS10' },
          { key: 'saturday-0900',                   label: 'Saturday Parcel by 09:00',           code: 'NS09' },
          // Saturday lightweight
          { key: 'saturday-light-1200',             label: 'Saturday Lightweight by 12:00',      code: 'LS12' },
          { key: 'saturday-light-1000',             label: 'Saturday Lightweight by 10:00',      code: 'LS10' },
          { key: 'saturday-light-0900',             label: 'Saturday Lightweight by 09:00',      code: 'LS09' },
          // Saturday courier pack
          { key: 'saturday-courier-pack-1200',      label: 'Saturday Courier Pack by 12:00',     code: 'CS12' },
          { key: 'saturday-courier-pack-1000',      label: 'Saturday Courier Pack by 10:00',     code: 'CS10' },
          { key: 'saturday-courier-pack-0900',      label: 'Saturday Courier Pack by 09:00',     code: 'CS09' },
          // Saturday mail pack
          { key: 'saturday-mail-pack-1200',         label: 'Saturday Mail Pack by 12:00',        code: 'MS12' },
          { key: 'saturday-mail-pack-1000',         label: 'Saturday Mail Pack by 10:00',        code: 'MS10' },
          { key: 'saturday-mail-pack-0900',         label: 'Saturday Mail Pack by 09:00',        code: 'MS09' },
          // Saturday liquid
          { key: 'saturday-liquid-1200',            label: 'Saturday Liquid Product by 12:00',   code: 'SL12' },
          { key: 'saturday-liquid-1000',            label: 'Saturday Liquid Product by 10:00',   code: 'SL10' },
          { key: 'saturday-liquid-0900',            label: 'Saturday Liquid Product by 09:00',   code: 'SL09' },
          // Saturday limited quantity
          { key: 'saturday-limited-quantity-1200',  label: 'Saturday Limited Quantity by 12:00', code: 'SQ12' },
          { key: 'saturday-limited-quantity-1000',  label: 'Saturday Limited Quantity by 10:00', code: 'SQ10' },
          { key: 'saturday-limited-quantity-0900',  label: 'Saturday Limited Quantity by 09:00', code: 'SQ09' },
          // Saturday non-conveyable
          { key: 'saturday-non-conveyable-1200',    label: 'Saturday Non-Conveyable by 12:00',   code: 'SN12' },
          { key: 'saturday-non-conveyable-1000',    label: 'Saturday Non-Conveyable by 10:00',   code: 'SN10' },
          { key: 'saturday-non-conveyable-0900',    label: 'Saturday Non-Conveyable by 09:00',   code: 'SN09' },
          // Saturday excess
          { key: 'saturday-excess-1200',            label: 'Saturday Excess Parcel by 12:00',    code: 'SX12' },
          { key: 'saturday-excess-1000',            label: 'Saturday Excess Parcel by 10:00',    code: 'SX10' },
          { key: 'saturday-excess-0900',            label: 'Saturday Excess Parcel by 09:00',    code: 'SX09' },
          // Ireland road service
          { key: 'ireland-road',                    label: '2-5 Day Road Service to Ireland',    code: 'ROAD' },
          { key: 'ireland-road-return',             label: '2-5 Day Road Service from Ireland',  code: 'RD16' },
          // 2nd class mail (via Whistl)
          { key: 'second-class-mail',               label: '2nd Class Mail (Whistl)',            code: 'POST' },
        ],
        note: 'These services are for UK addresses; the tools book UK addresses only. Pass either the friendly key (e.g. "next-day") or the raw ProductCode (e.g. "ND16") to book_shipment. Service availability depends on your APC contract and destination, so confirm with your depot.',
      }, null, 2),
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
