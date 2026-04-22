/**
 * APC Overnight API v3 "New Horizon" client
 * Built against Edition 2.0.5 integration guide
 *
 * Base URL:  https://apc.hypaship.com/api/3.0  (live)
 *            https://apc-training.hypaship.com/api/3.0  (training/test)
 *
 * Auth:      Header "remote-user: Basic {base64(email:password)}"
 *            Note: NOT the standard Authorization header
 */

const BASE_URL = process.env.APC_BASE_URL || 'https://apc.hypaship.com/api/3.0';

// ─── Service codes (from APC Integration Guide Edition 2.0.4, §3) ─────────────
// User-friendly keys mapped to real APC ProductCode values. Pass either the
// friendly key or the raw ProductCode (e.g. 'ND16') to createConsignment.
export const APC_SERVICES = {
  // ─── Weekday parcel ────────────────────────────────────────────────────────
  'next-day':            'ND16',   // Next day parcel by 16:00 (standard)
  'next-day-1200':       'ND12',
  'next-day-1000':       'ND10',
  'next-day-0900':       'ND09',
  'two-five-day':        'TDAY',   // 2-5 day parcel (economy)

  // ─── Weekday lightweight ───────────────────────────────────────────────────
  'next-day-light':      'LW16',
  'next-day-light-1200': 'LW12',
  'next-day-light-1000': 'LW10',
  'next-day-light-0900': 'LW09',
  'two-five-day-light':  'TDLW',

  // ─── Weekday courier pack (pre-printed, up to 5kg) ─────────────────────────
  'courier-pack':              'CP16',
  'courier-pack-1200':         'CP12',
  'courier-pack-1000':         'CP10',
  'courier-pack-0900':         'CP09',
  'two-five-day-courier-pack': 'TDCP',

  // ─── Weekday mail pack (pre-printed, up to 1kg) ────────────────────────────
  'mail-pack':              'MP16',
  'mail-pack-1200':         'MP12',
  'mail-pack-1000':         'MP10',
  'mail-pack-0900':         'MP09',
  'two-five-day-mail-pack': 'TDMP',

  // ─── Weekday liquid product ────────────────────────────────────────────────
  'liquid':              'LP16',
  'liquid-1200':         'LP12',
  'liquid-1000':         'LP10',
  'liquid-0900':         'LP09',
  'two-five-day-liquid': 'TDLP',

  // ─── Weekday limited quantity (dangerous goods under LQ exemption) ─────────
  'limited-quantity':      'LQ16',
  'limited-quantity-1200': 'LQ12',
  'limited-quantity-1000': 'LQ10',
  'limited-quantity-0900': 'LQ09',

  // ─── Weekday non-conveyable ────────────────────────────────────────────────
  'non-conveyable':              'NC16',
  'non-conveyable-1200':         'NC12',
  'non-conveyable-1000':         'NC10',
  'non-conveyable-0900':         'NC09',
  'two-five-day-non-conveyable': 'TDNC',

  // ─── Weekday excess parcel (oversize) ──────────────────────────────────────
  'excess':      'XS16',
  'excess-1200': 'XS12',
  'excess-1000': 'XS10',
  'excess-0900': 'XS09',

  // ─── Saturday parcel ───────────────────────────────────────────────────────
  'saturday-1200': 'NS12',
  'saturday-1000': 'NS10',
  'saturday-0900': 'NS09',

  // ─── Saturday lightweight ──────────────────────────────────────────────────
  'saturday-light-1200': 'LS12',
  'saturday-light-1000': 'LS10',
  'saturday-light-0900': 'LS09',

  // ─── Saturday courier pack ─────────────────────────────────────────────────
  'saturday-courier-pack-1200': 'CS12',
  'saturday-courier-pack-1000': 'CS10',
  'saturday-courier-pack-0900': 'CS09',

  // ─── Saturday mail pack ────────────────────────────────────────────────────
  'saturday-mail-pack-1200': 'MS12',
  'saturday-mail-pack-1000': 'MS10',
  'saturday-mail-pack-0900': 'MS09',

  // ─── Saturday liquid ───────────────────────────────────────────────────────
  'saturday-liquid-1200': 'SL12',
  'saturday-liquid-1000': 'SL10',
  'saturday-liquid-0900': 'SL09',

  // ─── Saturday limited quantity ─────────────────────────────────────────────
  'saturday-limited-quantity-1200': 'SQ12',
  'saturday-limited-quantity-1000': 'SQ10',
  'saturday-limited-quantity-0900': 'SQ09',

  // ─── Saturday non-conveyable ───────────────────────────────────────────────
  'saturday-non-conveyable-1200': 'SN12',
  'saturday-non-conveyable-1000': 'SN10',
  'saturday-non-conveyable-0900': 'SN09',

  // ─── Saturday excess ───────────────────────────────────────────────────────
  'saturday-excess-1200': 'SX12',
  'saturday-excess-1000': 'SX10',
  'saturday-excess-0900': 'SX09',

  // ─── Ireland road service ──────────────────────────────────────────────────
  'ireland-road':        'ROAD',   // 2-5 day to Ireland
  'ireland-road-return': 'RD16',   // 2-5 day from Ireland

  // ─── 2nd class mail (via Whistl) ───────────────────────────────────────────
  'second-class-mail': 'POST',
};

// Item types accepted by APC
export const APC_ITEM_TYPES = ['PARCEL', 'PACK', 'LIQUIDS', 'LIMITED QUANTITIES'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert YYYY-MM-DD → DD/MM/YYYY (APC date format)
 */
function toApcDate(isoDate) {
  if (!isoDate) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Build the Items.Item value for a consignment.
 *
 * APC requires the number of Item entries to match NumberOfPieces. If the caller
 * supplies a per-item `items` array it's used verbatim; otherwise we split
 * totalWeightKg evenly across numberOfPieces and emit one Item per piece.
 *
 * Returns a single Item object when count === 1, an array when count > 1
 * (matches APC's wire format per Integration Guide §4).
 */
function buildItems(params) {
  const count = Math.max(1, parseInt(params.numberOfPieces, 10) || 1);
  const type  = params.itemType || 'PARCEL';
  const refBase = params.reference || '';

  if (Array.isArray(params.items) && params.items.length > 0) {
    const built = params.items.map((it, i) => ({
      Type:      it.type   || type,
      Weight:    String(it.weightKg ?? 1),
      Length:    String(it.lengthCm ?? '0'),
      Width:     String(it.widthCm  ?? '0'),
      Height:    String(it.heightCm ?? '0'),
      Value:     String(it.value ?? params.goodsValue ?? '1'),
      Reference: it.reference || (refBase ? `${refBase}-${i + 1}` : undefined),
    }));
    return built.length === 1 ? built[0] : built;
  }

  const total = parseFloat(params.totalWeightKg) || 1;
  const per   = (total / count);
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      Type:      type,
      Weight:    per.toFixed(3),
      Length:    String(params.lengthCm || '0'),
      Width:     String(params.widthCm  || '0'),
      Height:    String(params.heightCm || '0'),
      Value:     String(params.goodsValue || '1'),
      Reference: refBase ? `${refBase}-${i + 1}` : undefined,
    });
  }
  return items.length === 1 ? items[0] : items;
}

/**
 * Build the remote-user Basic auth header value
 * APC uses "remote-user" header instead of the standard "Authorization" header
 */
function getAuthHeader() {
  const username = process.env.APC_USERNAME;
  const password = process.env.APC_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'APC credentials not set. Add APC_USERNAME and APC_PASSWORD to your .env file.'
    );
  }

  const encoded = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

async function request(method, path, body = null) {
  const url = `${BASE_URL}${path}`;

  const options = {
    method,
    headers: {
      'remote-user':  getAuthHeader(),
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`APC API ${response.status}: ${error}`);
  }

  return response.json();
}

// ─── Service availability (optional pre-check) ────────────────────────────────

export async function checkServiceAvailability({
  collectionDate,
  collectionPostcode,
  deliveryPostcode,
  weightKg = 1,
  numberOfPieces = 1,
}) {
  const body = {
    Orders: {
      Order: {
        CollectionDate: toApcDate(collectionDate),
        ReadyAt:        '09:00',
        ClosedAt:       '17:00',
        Collection: {
          PostalCode:   collectionPostcode,
          CountryCode:  'GB',
        },
        Delivery: {
          PostalCode:   deliveryPostcode,
          CountryCode:  'GB',
        },
        GoodsInfo: {
          GoodsValue:        '1',
          GoodsDescription:  'Goods',
          PremiumInsurance:  'False',
        },
        ShipmentDetails: {
          NumberOfPieces: String(numberOfPieces),
          Items: {
            Item: {
              Type:   'PARCEL',
              Weight: String(weightKg),
              Length: '1',
              Width:  '1',
              Height: '1',
              Value:  '1',
            },
          },
        },
      },
    },
  };

  return request('POST', '/ServiceAvailability.json', body);
}

// ─── Place order (book a consignment) ────────────────────────────────────────

export async function createConsignment(params) {
  const productCode = APC_SERVICES[params.service] || params.service || 'ND16';

  const body = {
    Orders: {
      Order: {
        CollectionDate: toApcDate(params.collectionDate),
        ReadyAt:        params.readyAt  || '09:00',
        ClosedAt:       params.closedAt || '17:00',
        ProductCode:    productCode,
        Reference:      params.reference || '',

        Collection: {
          CompanyName:  params.sender.companyName  || '',
          AddressLine1: params.sender.addressLine1,
          AddressLine2: params.sender.addressLine2 || '',
          PostalCode:   params.sender.postcode,
          City:         params.sender.city || params.sender.town || '',
          County:       params.sender.county  || '',
          CountryCode:  'GB',
          Contact: {
            PersonName:  params.sender.contactName,
            PhoneNumber: params.sender.phone,
            Email:       params.sender.email || null,
          },
        },

        Delivery: {
          CompanyName:  params.recipient.companyName  || '',
          AddressLine1: params.recipient.addressLine1,
          AddressLine2: params.recipient.addressLine2 || '',
          PostalCode:   params.recipient.postcode,
          City:         params.recipient.city || params.recipient.town || '',
          County:       params.recipient.county  || '',
          CountryCode:  'GB',
          Contact: {
            PersonName:   params.recipient.contactName,
            PhoneNumber:  params.recipient.phone,
            MobileNumber: params.recipient.mobilePhone || null,
            Email:        params.recipient.email || null,
          },
          Instructions: params.recipient.instructions || null,
        },

        GoodsInfo: {
          GoodsValue:       String(params.goodsValue || '1'),
          GoodsDescription: params.goodsDescription || 'Goods',
          Fragile:          'false',
          Security:         'false',
          IncreasedLiability: 'false',
        },

        ShipmentDetails: {
          NumberOfPieces: String(params.numberOfPieces || 1),
          Items: {
            Item: buildItems(params),
          },
        },
      },
    },
  };

  const result = await request('POST', '/Orders.json', body);

  const order = result?.Orders?.Order;
  return {
    success:        result?.Orders?.Messages?.Code === 'SUCCESS',
    waybill:        order?.WayBill,
    orderNumber:    order?.OrderNumber,
    productCode:    order?.ProductCode,
    collectionDate: order?.CollectionDate,
    raw: result,
  };
}

// ─── Get label ────────────────────────────────────────────────────────────────

export async function getLabel(waybill, format = 'PDF', { retries = 4, retryDelayMs = 3000 } = {}) {
  const path = `/Orders/${waybill}.json?labelformat=${format}&markprinted=True&searchtype=CarrierWaybill&labels=True`;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await request('GET', path);
      const items = result?.Orders?.Order?.ShipmentDetails?.Items?.Item;

      // Multi-piece responses come back as an array; single-piece as an object.
      // The first item carries the full Label payload APC generates for the consignment.
      const first = Array.isArray(items) ? items[0] : items;
      const label = first?.Label;

      if (label?.Content) {
        return {
          success: true,
          waybill,
          format:      label.Format || format,
          labelBase64: label.Content,
        };
      }
      lastError = new Error('Label not yet available');
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      await new Promise(r => setTimeout(r, retryDelayMs));
    }
  }

  throw new Error(
    `Label not available after ${retries + 1} attempts over ~${((retries + 1) * retryDelayMs) / 1000}s. ` +
    `APC may still be generating it — try calling get_label again in a moment. ` +
    `Last error: ${lastError?.message}`
  );
}

// ─── Track consignment ────────────────────────────────────────────────────────

export async function trackConsignment(waybill) {
  const path = `/Tracks/${waybill}.json?searchtype=CarrierWaybill&history=yes`;
  const result = await request('GET', path);

  const tracks = result?.Tracks;
  const track  = Array.isArray(tracks?.Track) ? tracks.Track[0] : tracks?.Track;

  return {
    success: true,
    waybill,
    status: track?.Status || track?.Description || 'Unknown',
    events: Array.isArray(tracks?.Track) ? tracks.Track : (track ? [track] : []),
    raw: result,
  };
}

// ─── Cancel consignment ───────────────────────────────────────────────────────

export async function cancelConsignment(waybill) {
  // PUT with CancelOrder wrapper and Status=CANCELLED (Edition 2.0.5, §6)
  const body = {
    CancelOrder: {
      Order: {
        Status: 'CANCELLED',
      },
    },
  };

  const result = await request('PUT', `/Orders/${waybill}.json?searchtype=CarrierWaybill`, body);

  const messages = result?.CancelOrder?.Messages;
  return {
    success: messages?.Code === '121' || /cancelled/i.test(messages?.Description || ''),
    waybill,
    message: messages?.Description || 'Cancellation request sent.',
    raw: result,
  };
}
