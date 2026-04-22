# apc-mcp

[![npm version](https://img.shields.io/npm/v/apc-mcp.svg)](https://www.npmjs.com/package/apc-mcp)
[![licence](https://img.shields.io/badge/licence-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![CI](https://github.com/catrinmdonnelly/apc-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/catrinmdonnelly/apc-mcp/actions/workflows/ci.yml)

Book, label, track and cancel APC Overnight parcels from any MCP-compatible AI such as Claude, Cursor, or Windsurf.

Built against the [APC Overnight New Horizon API v3](https://apc-overnight.com/) (Integration Guide Edition 2.0.5).

## What it does

Exposes five tools to any AI that speaks MCP:

| Tool | What it does |
|------|--------------|
| `book_shipment`   | Create a consignment. Returns the 22-digit WayBill. |
| `get_label`       | Fetch the shipping label. PDF, ZPL (thermal printers) or PNG. |
| `track_shipment`  | Current status and full tracking history. |
| `cancel_shipment` | Cancel a consignment before it's manifested. |
| `list_services`   | Every APC service this MCP supports, with ProductCodes. |

Under the hood it talks to `https://apc.hypaship.com/api/3.0` using your APC account credentials.

## Example prompts

Once the MCP is installed in your AI client, you can say things like:

> *"Book a next-day collection from our warehouse to Alex Taylor, 45 High Street, Manchester M1 1AA, 15 kg, 1 parcel, reference INV-4412."*

> *"Book a Saturday 12:00 delivery to this address, then give me the label as a PDF."*

> *"Track all APC consignments from this week. Which ones haven't been delivered yet?"*

> *"Print labels for these five waybills as ZPL so I can send them to the thermal printer."*

> *"Cancel waybill 2018041910099660000599. The customer cancelled the order."*

> *"What's the cheapest APC service that arrives before noon tomorrow?"* (AI calls `list_services` and reasons)

The AI handles address parsing, service selection and error recovery. You handle the business decisions.

## Workflow ideas for businesses

Plugged into any AI agent, this MCP can automate real shipping operations:

- **Daily order fulfilment.** Every morning, your AI reads new orders from your ecommerce platform, books each one with APC at the right service level, and posts tracking numbers back to the customer.
- **Thermal-printer workflows.** Get labels as ZPL and pipe them straight to Zebra, Rollo or similar printers without any PDF conversion step.
- **Same-day cut-off triage.** Before the APC cut-off, your AI checks which orders still qualify for next-day-by-10am versus standard next-day, and books the fastest available service for each.
- **Bulk manifests.** Hand your AI a spreadsheet of hundreds of consignments. It books them all, groups labels into one document per depot, and flags any that failed validation.
- **Multi-carrier picking.** Installed alongside [royalmail-mcp](https://github.com/catrinmdonnelly/royalmail-mcp), your AI compares APC and Royal Mail at booking time and picks the cheapest or fastest option per destination.
- **Customer service triage.** When a customer asks where their parcel is, your AI calls `track_shipment`, summarises the latest scan in plain English, and drafts a reply.

## Compatibility

Works with any MCP client that supports stdio transport:

- Claude Desktop
- Cursor
- Windsurf
- Claude Code
- Zed

ChatGPT, Smithery and other remote-only MCP clients need an HTTP transport, which isn't included yet. If that matters to you, open an issue so I can prioritise it.

## Install

```bash
npm install -g apc-mcp
```

Or run without installing:

```bash
npx apc-mcp
```

## Configuration

Your APC credentials are the same ones you use to log into the APC portal:

```
APC_USERNAME=your-apc-account-email@example.com
APC_PASSWORD=your-apc-account-password
APC_BASE_URL=https://apc.hypaship.com/api/3.0
```

Either in a `.env` file next to the server, or via your MCP client's config (see below).

Use `https://apc-training.hypaship.com/api/3.0` while testing. APC provides a training endpoint that won't charge your account or send real parcels.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apc": {
      "command": "npx",
      "args": ["-y", "apc-mcp"],
      "env": {
        "APC_USERNAME": "your-email@example.com",
        "APC_PASSWORD": "your-password"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "apc": {
      "command": "npx",
      "args": ["-y", "apc-mcp"],
      "env": {
        "APC_USERNAME": "your-email@example.com",
        "APC_PASSWORD": "your-password"
      }
    }
  }
}
```

## Supported services

A selection of the most common codes — run `list_services` for the full catalogue of 60+ ProductCodes covering every APC product type.

| Key | APC service | ProductCode |
|-----|-------------|-------------|
| `next-day`                 | Next Day Parcel by 16:00 (standard)  | `ND16` |
| `next-day-1200`            | Next Day Parcel by 12:00             | `ND12` |
| `next-day-1000`            | Next Day Parcel by 10:00             | `ND10` |
| `next-day-0900`            | Next Day Parcel by 09:00             | `ND09` |
| `two-five-day`             | 2-5 Day Parcel (economy)             | `TDAY` |
| `saturday-1200`            | Saturday Parcel by 12:00             | `NS12` |
| `next-day-light`           | Next Day Lightweight by 16:00        | `LW16` |
| `courier-pack`             | Next Day Courier Pack by 16:00       | `CP16` |
| `mail-pack`                | Next Day Mail Pack by 16:00          | `MP16` |
| `liquid`                   | Next Day Liquid Product by 16:00     | `LP16` |
| `limited-quantity`         | Next Day Limited Quantity by 16:00   | `LQ16` |
| `non-conveyable`           | Next Day Non-Conveyable by 16:00     | `NC16` |
| `excess`                   | Next Day Excess Parcel by 16:00      | `XS16` |
| `ireland-road`             | 2-5 Day Road Service to Ireland      | `ROAD` |
| `second-class-mail`        | 2nd Class Mail (Whistl)              | `POST` |

Plus 45 more, including all 09:00 / 10:00 / 12:00 variants of each product type, every Saturday variant, and 2-5 day economy versions of lightweight, courier-pack, mail-pack, liquid and non-conveyable.

You can pass either the friendly key (`next-day`) or the raw ProductCode (`ND16`). Both work. Which services your account can use depends on your APC contract — confirm with your depot for unusual codes.

## Notes

- `get_label` retries automatically for up to ~15 seconds while APC generates the label, so you normally don't need to pause between `book_shipment` and `get_label`.
- `cancel_shipment` only works before the parcel is manifested. Once it's been collected by APC, you have to cancel via the APC portal.
- Label formats: `PDF` for standard printers, `ZPL` for Zebra or Rollo thermal printers, `PNG` for on-screen display.

### Account-specific service availability

Not every `ProductCode` is enabled on every APC account. Timed services (09:00, 10:00), 2-5 day economy (`TDAY`) and specialised products (Liquid, Limited Quantity, Non-Conveyable) are often add-ons you have to ask your depot to enable.

If you see these responses, it's an account or routing issue — not a bug in this MCP:

- **`228 NO Services available`** — the requested service isn't enabled on your account for that collection/delivery postcode pair.
- **`119 ProductCode (XXXX) is not one of the possible options`** — that code isn't on your contract at all.

Call your APC depot or the CMS Team (01922 702587) to have extra services enabled.

### Multi-piece consignments

When `numberOfPieces > 1`, the MCP automatically splits `totalWeightKg` evenly across the parcels and sends one `Item` entry per piece (APC requires `NumberOfPieces` to match the number of items). If you need different weights or dimensions per parcel, pass a full `items` array — the MCP will use it verbatim.

## Security

Your APC username and password grant full access to your account. Treat them like a password.

- Never commit `.env` to git. The `.gitignore` in this repo already excludes it.
- Don't paste credentials into chat messages or shared documents.
- Rotate them in the APC portal if ever exposed.

## Contributing

Issues and pull requests are welcome at [github.com/catrinmdonnelly/apc-mcp](https://github.com/catrinmdonnelly/apc-mcp). If APC changes their API, or you hit an edge case on your account type, please open an issue with the request body you sent and the response you got (scrub credentials first).

## Companion MCP

For Royal Mail Click & Drop, see [royalmail-mcp](https://github.com/catrinmdonnelly/royalmail-mcp).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by APC Overnight Ltd. "APC Overnight" and "New Horizon" are trademarks of their respective owners. Use at your own risk.

## Licence

MIT. See [LICENSE](LICENSE).
