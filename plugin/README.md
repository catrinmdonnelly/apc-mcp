# Parcel Toolkit for APC Overnight

Book, label, track and cancel APC Overnight parcels by asking Claude. It uses your own APC account, so you need an APC account that has API access. It is made for people who are comfortable setting up developer tools, and it is not a product from APC.

## Set it up

Install the plugin in Claude Code. When you install it, Claude Code asks for your APC login: the email and password you use for the APC portal. It keeps the password in your computer's secure storage.

It runs in Claude Code, and in Cowork sessions that run on your computer. Cowork cannot ask for your login, so there you would need to add the server by hand, following the [apc-mcp README](https://github.com/catrinmdonnelly/apc-mcp#readme). It does not run in Claude in the browser or the phone app, which only connect to servers on the web.

## What you can ask

- Book a next day parcel to this address and collect it tomorrow.
- Book these ten orders and give me one PDF with all the labels.
- Where is the parcel with this waybill number?
- Cancel the booking I made this morning.
- Which APC services can I choose from?

## What it sends and where

- **To APC.** For each parcel you book, the names, addresses, phone numbers, weights and references go from your computer straight to APC's API at apc.hypaship.com, using your APC login. When Claude fetches a label, APC also marks that parcel as printed.
- **On your computer.** Label files are saved to the `parcel-toolkit` folder inside your Downloads folder. They show your recipients' names and addresses, and so does `bookings.jsonl`, a running record of what has been booked. All of it stays there until you delete it.
- **To Parcel Toolkit or anyone else.** Nothing. There is no server of ours in the middle, and we do not see your parcels or your login.
- **What it runs.** When Claude Code starts the plugin it runs `npx apc-mcp@0.2.1`, which downloads that exact version of the open source [apc-mcp](https://www.npmjs.com/package/apc-mcp) package from npm.

## Booking spends money

Booking and cancelling change your APC account, and a booking can cost you money. The plugin marks both as actions that change things, and Claude Code normally asks you to approve each one, though that depends on your own permission settings. Booking a list books every parcel in it in one go, up to 50 at a time, so check the list before you approve.

## Support and licence

Report problems at [github.com/catrinmdonnelly/apc-mcp/issues](https://github.com/catrinmdonnelly/apc-mcp/issues). MIT licence. Parcel Toolkit is not affiliated with APC Overnight.
