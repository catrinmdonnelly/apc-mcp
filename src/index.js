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
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

const server = new McpServer({
  name: 'apc-mcp',
  version: '0.1.0',
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
      'Defaults to ND16 (standard next day by 16:00) if omitted.'
    ),

    collectionDate: z.string().describe('Collection date. YYYY-MM-DD or DD/MM/YYYY'),

    readyAt:   z.string().optional().describe('Time goods will be ready HH:MM (default 09:00)'),
    closedAt:  z.string().optional().describe('Time business closes HH:MM (default 17:00)'),

    numberOfPieces: z.number().int().min(1).describe('Number of parcels/items in this consignment'),
    totalWeightKg:  z.number().positive().describe('Total weight in kg'),

    itemType: z.enum(['PARCEL', 'PACK', 'LIQUIDS', 'LIMITED QUANTITIES'])
      .default('PARCEL')
      .describe('Type of goods being sent'),

    goodsValue: z.number().optional().describe('Declared value in GBP'),
    goodsDescription: z.string().optional().describe('Brief description of goods'),

    sender:    addressSchema.describe('Sender / collection address'),
    recipient: addressSchema.describe('Recipient / delivery address'),

    reference: z.string().optional().describe('Your internal order or job reference'),
  },
  async (params) => {
    try {
      const result = await apc.createConsignment(params);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: result.success,
            carrier: 'APC Overnight',
            waybill: result.waybill,
            orderNumber: result.orderNumber,
            productCode: result.productCode,
            collectionDate: params.collectionDate,
            service: params.service,
            pieces: params.numberOfPieces,
            weightKg: params.totalWeightKg,
            recipient: `${params.recipient.contactName}, ${params.recipient.postcode}`,
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
  'Get the shipping label for a booked APC consignment. Call 3-5 seconds after book_shipment. Returns base64-encoded label.',
  {
    waybill: z.string().describe('The 22-digit WayBill number returned when booking'),
    format:  z.enum(['PDF', 'ZPL', 'PNG']).default('PDF').describe('Label format. PDF for standard printers, ZPL for thermal (Zebra/Rollo)'),
  },
  async ({ waybill, format }) => {
    try {
      const result = await apc.getLabel(waybill, format);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            waybill,
            format: result.format,
            labelBase64: result.labelBase64,
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

server.tool(
  'track_shipment',
  'Get the current status and tracking history for an APC Overnight consignment.',
  {
    waybill: z.string().describe('The 22-digit WayBill number'),
  },
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
  'List every APC Overnight delivery service with friendly key, label and ProductCode. Service availability depends on your APC account and routing — confirm with your depot before relying on an unusual service.',
  {},
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
        note: 'Pass either the friendly key (e.g. "next-day") or the raw ProductCode (e.g. "ND16") to book_shipment. Service availability depends on your APC contract and destination — confirm with your depot.',
      }, null, 2),
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
