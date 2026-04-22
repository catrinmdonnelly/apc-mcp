# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
