# Parking Date Analysis

Static HTML/CSS/JS dashboard for Safety Park CSV analysis.

## Run locally

```powershell
python no_cache_server.py
```

Open:

```text
http://localhost:8000/index.html?v=120
```

## Files

- `index.html` - page layout
- `style.css` - styles
- `app.js` - CSV parsing, hourly graphs, and current open-ticket counting
- `sample_open_tickets.csv` - small test file
- `no_cache_server.py` - local no-cache server for development

## Open ticket logic

The "Cars in lots right now" page counts rows as open tickets when there is no exit time and the ticket status is not closed/canceled/void/refunded. Extension rows are ignored when `Extended By` is filled or when transaction description, ticket type, or reason mentions extension/extend/renewal.
