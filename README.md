# Parking Date Analysis

Static HTML/CSS/JS dashboard for Safety Park CSV analysis.

## Run locally

```powershell
python no_cache_server.py
```

Open:

```text
http://localhost:8000/index.html?v=130
```

## Files

- `index.html` - page layout
- `style.css` - styles
- `app.js` - CSV parsing, hourly graphs, current open-ticket counting, and ticket-type summaries
- `sample_open_tickets.csv` - small test file
- `no_cache_server.py` - local no-cache server for development

## Open ticket logic

The "Cars in lots right now" page counts rows as open tickets when there is no exit time and the ticket status is not closed/canceled/void/refunded. Extension rows are ignored when `Extended By` is filled or when transaction description, ticket type, or reason mentions extension/extend/renewal.


## Ticket type summary

The "Ticket types" page counts tickets in a selected time window by transaction time or entry time. It classifies rows into categories such as 1h, 2h, 3h, All day, Overnight, Event, Monthly, Extension, and Unknown / other. Extension rows are counted as their own ticket type instead of being mixed into duration buckets.
