# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-11-09

### Added
- Every tool now has a title and a read-only or destructive label, which Claude's directory requires. Booking and cancelling are marked destructive, which some clients use when deciding whether to ask you first. The label is advice to the client, not something this server enforces.
- The MCP Registry name `io.github.catrinmdonnelly/apc-mcp`.

### Changed
- `.env.example` is no longer published to npm. The README lists the settings, and the file is still in the repository.

### Fixed
- A booking that APC does not confirm is reported as failed instead of going on to fetch a label for a missing waybill.
- ZPL and PNG batches save one file per label. Before, only PDF batches could be saved.
- `get_label` now says that APC marks the consignment as printed when the label is fetched.
- Batch booking now records every booking before it fetches any label. Before, a label that could not be fetched made a parcel that was already booked look like a failure, so asking again would have booked it twice. Booked parcels are always reported, with a note on any that have no saved label.
- Labels are saved only inside the labels folder. File names and extensions built from carrier or user text are cleaned, existing files are never overwritten, and files are readable by you only.
- Waybills and order identifiers are checked before they go into a web address, so a crafted value cannot reach a different carrier endpoint.
- Text from the carrier is cleaned and cut short before Claude sees it, including error messages, tracking events and order status.
- The carrier address must be https (plain http only for localhost), requests time out after 30 seconds, and redirects are refused so credentials cannot be sent elsewhere.
- Settings passed in by the MCP client now win over the `.env` file.
- A batch is limited to 50 shipments.
- Every booking is written to `bookings.jsonl` in the labels folder as it happens, so a batch cut short by the client still leaves a record of what was booked.
- One label that cannot be read no longer loses the merge for the others.
- A failure that may have happened after the carrier accepted the booking (a timeout, a connection drop, a server error) now says so, so Claude checks before booking again.
- Dates are checked: only YYYY-MM-DD or DD/MM/YYYY, and only real dates. Before, `12/11/2026` could be read as 11 December in Royal Mail bookings.
- Invisible and direction-changing characters are removed from carrier text, and values such as waybills are cleaned too.
- Tool descriptions no longer promise defaults or inputs that the tools do not have. `book_order` now accepts raw Service Register codes as its description said.
- The service list says the tools book UK addresses only.
- A booking that APC confirms with a warning code is kept as a booking, with the warning shown, instead of being dropped.
- A refused cancellation is no longer reported as a success. Before, "could not be cancelled" counted as cancelled.
- `book_shipment` now shows APC's reason when a booking is not confirmed.
- Pieces and weight have upper limits (50 pieces, 2,000 kg).

### Security
- Updated `@modelcontextprotocol/sdk` to 1.32.2 and `zod` to 4.6.7, and refreshed the packages they bring in, including `proxy-addr`, `body-parser`, `fast-uri`, `hono`, `ip-address` and `qs`. `npm audit` now reports no findings.

## [0.2.0] - 2026-04-24

### Added
- New `book_batch_and_label` tool: book many shipments in one call and get back a single merged PDF of every label, ready to print. All shipments share the same service, collection date and sender.
- `get_label` now saves the label to disk and returns a file path instead of a base64 string in JSON. Default location: `~/Downloads/parcel-toolkit/`, overridable via `PARCEL_TOOLKIT_LABELS_DIR`.
- New dependency: `pdf-lib` for merging PDFs.

### Changed
- **Breaking:** `get_label` response shape changed. Old response had `labelBase64`; new response has `filePath`. The label file is written to disk as part of the call. Callers expecting the base64 payload should either read the file from `filePath` or pin to `0.1.x`.

## [0.1.0] - 2026-04-22

### Added
- Initial release.
- Five MCP tools: `book_shipment`, `get_label`, `track_shipment`, `cancel_shipment`, `list_services`.
- Friendly keys for 60+ APC Overnight ProductCodes covering every product type: Parcel, Lightweight, Courier Pack, Mail Pack, Liquid Product, Limited Quantity, Non-Conveyable, Excess Parcel, Ireland Road Service and 2nd Class Mail (Whistl). Weekday 09:00/10:00/12:00/16:00 and Saturday variants all included.
- Raw ProductCodes (`ND16`, `ND09`, `NS12`, `CP16`, `LP09`, `ROAD`, `POST`, etc.) also accepted at booking as a pass-through.
- Multi-piece consignments: when `numberOfPieces > 1` the carrier emits one `Item` per parcel and splits `totalWeightKg` evenly, or uses the caller's `items[]` array if supplied. Matches APC's requirement that `NumberOfPieces` equals the number of `Item` entries.
- `get_label` retries up to 5 times over ~15 seconds while APC generates the label asynchronously. Multi-piece labels are read from the first item in the response array (APC attaches the full consignment label payload there).
- Live end-to-end verified against a real APC business account on 2026-04-22: 6 scenarios across standard next-day, Saturday, multi-piece, lightweight and different UK regions — book, label, cancel all confirmed.
- Static review against APC New Horizon API v3 Integration Guide Edition 2.0.4: auth (`remote-user` header), DD/MM/YYYY date format, booking body, label query params (`labelformat`, `markprinted`, `searchtype`, `labels`), tracking endpoint and `CancelOrder` wrapper (success code 121) all verified.
