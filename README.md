# Run the app
python -m http.server 8000

# Safety Park Hourly Entry Dashboard v4

This is a GitHub Pages-ready static dashboard. It runs entirely in the browser with HTML, CSS, and JavaScript.

## What changed in v4

- Controls moved to a right-side panel so the graph stays centered.
- The Generate Graph button was removed. Charts update automatically.
- Parking lot selection now supports:
  - all lots
  - one lot
  - multiple selected lots
  - selecting every visible lot after searching
- The parser still supports Safety Park CSV reports that start with a title row before the real headers.

## How to run locally

1. Unzip the folder.
2. Open `index.html` in your browser.
3. Upload a Safety Park CSV.

## How to use multi-lot selection

1. Upload your CSV.
2. In the right controls panel, click **Choose lots**.
3. Search for a lot, for example `155` or `Arbor`.
4. Check as many lots as you want.
5. The chart updates automatically.

## GitHub Pages

Upload `index.html` to your repository and enable GitHub Pages from Settings → Pages.
