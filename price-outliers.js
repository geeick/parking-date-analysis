(() => {
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  const cash = value => Number.isFinite(Number(value)) ? money.format(Number(value)) : "--";
  const esc = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  let lastRows = [];

  function hasData() {
    return typeof state !== "undefined" && Array.isArray(state.records) && state.records.length > 0;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseKey(key) {
    if (window.ParkingComparison?.parseKey) return ParkingComparison.parseKey(key);
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(+match[1], +match[2] - 1, +match[3], 12) : null;
  }

  function recordTime(record, basis) {
    return basis === "entry" ? record.entryDateObj : (record.paymentDateObj || record.entryDateObj);
  }

  function validPaid(record) {
    if (!Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) return false;
    const status = String(record.ticketStatus || "").toLowerCase();
    return !status.includes("cancel") &&
      !status.includes("void") &&
      !status.includes("refund");
  }

  function ticketType(record) {
    return typeof classifyTicketType === "function"
      ? classifyTicketType(record)
      : (record.ticketType || "Unknown / other");
  }

  function usableType(type) {
    const text = String(type || "").toLowerCase();
    return Boolean(text) &&
      !text.includes("extension") &&
      !text.includes("unknown") &&
      !text.includes("monthly") &&
      !text.includes("event");
  }

  function typeOrder(type) {
    const text = String(type || "").toLowerCase();
    const minutes = text.match(/^(\d+(?:\.\d+)?)m$/);
    if (minutes) return Number(minutes[1]) / 60;
    const hours = text.match(/^(\d+(?:\.\d+)?)h$/);
    if (hours) return Number(hours[1]);
    if (text.includes("all day")) return 50;
    if (text.includes("overnight")) return 60;
    return 40;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function average(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length
      ? valid.reduce((sum, value) => sum + value, 0) / valid.length
      : null;
  }

  function groupByDate(records, basis) {
    const map = new Map();
    records.forEach(record => {
      const time = recordTime(record, basis);
      if (!time) return;
      const key = dateKey(time);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    });
    return map;
  }

  function groupTypePrices(records) {
    const types = new Map();
    records.forEach(record => {
      const type = ticketType(record);
      if (!usableType(type)) return;
      if (!types.has(type)) types.set(type, new Map());
      const prices = types.get(type);
      const priceKey = Number(record.amount).toFixed(2);
      if (!prices.has(priceKey)) prices.set(priceKey, { price: Number(record.amount), count: 0 });
      prices.get(priceKey).count += 1;
    });
    return types;
  }

  function dominantPrice(priceMap) {
    const rows = [...(priceMap?.values() || [])];
    if (!rows.length) return null;
    return rows.sort((a, b) => b.count - a.count || b.price - a.price)[0];
  }

  function exactPriceLabel(priceMap) {
    const rows = [...(priceMap?.values() || [])].sort((a, b) => a.price - b.price);
    if (!rows.length) return "--";
    return rows.map(row => `${cash(row.price)} × ${row.count}`).join(" · ");
  }

  function priceChips(priceMap) {
    const rows = [...(priceMap?.values() || [])].sort((a, b) => a.price - b.price);
    return `<div class="outlier-price-list">${rows.map(row => `<span class="outlier-price-chip">${cash(row.price)} × ${row.count}</span>`).join("")}</div>`;
  }

  function priorYearKey(targetKey) {
    const target = parseKey(targetKey);
    if (!target) return null;
    const prior = new Date(target.getFullYear() - 1, target.getMonth(), target.getDate(), 12);
    return prior.getMonth() === target.getMonth() && prior.getDate() === target.getDate()
      ? dateKey(prior)
      : null;
  }

  function acceptablePriorYear(byDate, targetKey, priorKey, context, tolerance) {
    if (!priorKey || !byDate.has(priorKey)) return false;
    const target = parseKey(targetKey);
    const prior = parseKey(priorKey);
    if (!target || !prior) return false;

    const typicalDemand = context?.targetMedian;
    const priorDemand = window.ParkingComparison?.demandCount
      ? ParkingComparison.demandCount(byDate.get(priorKey) || [])
      : (byDate.get(priorKey) || []).length;

    if (target.getDay() === prior.getDay()) {
      if (!Number.isFinite(typicalDemand) || typicalDemand <= 0) return true;
      return Math.abs(priorDemand - typicalDemand) / typicalDemand <= tolerance;
    }

    if (!Number.isFinite(typicalDemand) || typicalDemand <= 0) return false;
    return Math.abs(priorDemand - typicalDemand) / typicalDemand <= tolerance;
  }

  function historicalSummary(byDate, historyKeys, type) {
    const daily = [];
    let totalTickets = 0;
    const exactPrices = new Map();

    historyKeys.forEach(key => {
      const typePrices = groupTypePrices(byDate.get(key) || []).get(type);
      const dominant = dominantPrice(typePrices);
      if (!dominant) return;

      daily.push({ key, price: dominant.price, tickets: dominant.count });
      totalTickets += [...typePrices.values()].reduce((sum, row) => sum + row.count, 0);
      typePrices.forEach(row => {
        const priceKey = row.price.toFixed(2);
        if (!exactPrices.has(priceKey)) exactPrices.set(priceKey, { price: row.price, count: 0 });
        exactPrices.get(priceKey).count += row.count;
      });
    });

    const prices = daily.map(day => day.price);
    return {
      days: daily,
      dateCount: daily.length,
      ticketCount: totalTickets,
      averagePrice: average(prices),
      medianPrice: median(prices),
      minimumPrice: prices.length ? Math.min(...prices) : null,
      maximumPrice: prices.length ? Math.max(...prices) : null,
      exactPrices
    };
  }

  function confidence(currentTickets, historicalDates, historicalTickets) {
    if (currentTickets >= 5 && historicalDates >= 6 && historicalTickets >= 30) return ["High", "high"];
    if (currentTickets >= 2 && historicalDates >= 3 && historicalTickets >= 10) return ["Medium", "medium"];
    return ["Low", "low"];
  }

  function severity(dollarDifference, percentDifference) {
    const absoluteDollars = Math.abs(dollarDifference);
    const absolutePercent = Math.abs(percentDifference);
    if (absoluteDollars >= 15 || absolutePercent >= 0.50) return ["Large", "large"];
    if (absoluteDollars >= 10 || absolutePercent >= 0.30) return ["Moderate", "moderate"];
    return ["Notice", "notice"];
  }

  function analyze() {
    const targetKey = $("outlierDate")?.value;
    const basis = $("outlierBasis")?.value || "transaction";
    const perWeekdayCount = Number($("outlierHistoryCount")?.value || 6);
    const mode = $("outlierComparisonMode")?.value || "auto";
    const tolerance = Number($("outlierDemandTolerance")?.value || 0.20);
    const minimumDollars = Number($("outlierDollarThreshold")?.value || 5);
    const minimumPercent = Number($("outlierPercentThreshold")?.value || 0.20);
    const showMode = $("outlierShowMode")?.value || "flagged";
    if (!targetKey) return { rows: [], locationsScanned: 0, skipped: 0 };

    const paidRecords = state.records.filter(record => validPaid(record) && recordTime(record, basis));
    const locations = [...new Set(paidRecords.map(record => record.location).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const rows = [];
    let locationsScanned = 0;
    let skipped = 0;

    locations.forEach(location => {
      const locationRecords = paidRecords.filter(record => record.location === location);
      const byDate = groupByDate(locationRecords, basis);
      const currentRecords = byDate.get(targetKey) || [];
      if (!currentRecords.length) return;

      const currentTypes = groupTypePrices(currentRecords);
      if (!currentTypes.size) return;
      locationsScanned += 1;

      const priorKey = priorYearKey(targetKey);
      const context = window.ParkingComparison?.build
        ? ParkingComparison.build({
            byDate,
            targetKey,
            perWeekdayCount,
            mode,
            tolerance,
            excludeKey: priorKey
          })
        : { keys: [...byDate.keys()].filter(key => key < targetKey).sort((a, b) => b.localeCompare(a)).slice(0, perWeekdayCount), targetMedian: null };

      const historyKeys = [...context.keys];
      if (acceptablePriorYear(byDate, targetKey, priorKey, context, tolerance)) historyKeys.push(priorKey);
      const uniqueHistoryKeys = [...new Set(historyKeys)].sort((a, b) => b.localeCompare(a));

      currentTypes.forEach((currentPriceMap, type) => {
        const currentDominant = dominantPrice(currentPriceMap);
        if (!currentDominant) return;

        const historical = historicalSummary(byDate, uniqueHistoryKeys, type);
        if (historical.dateCount < 2 || !Number.isFinite(historical.averagePrice) || historical.averagePrice <= 0) {
          skipped += 1;
          return;
        }

        const difference = currentDominant.price - historical.averagePrice;
        const percentDifference = difference / historical.averagePrice;
        const isFlagged = Math.abs(difference) >= minimumDollars && Math.abs(percentDifference) >= minimumPercent;
        if (showMode === "flagged" && !isFlagged) return;

        const currentTickets = [...currentPriceMap.values()].reduce((sum, row) => sum + row.count, 0);
        const [confidenceLabel, confidenceClass] = confidence(currentTickets, historical.dateCount, historical.ticketCount);
        const [severityLabel, severityClass] = severity(difference, percentDifference);
        const direction = difference > 0 ? "Higher" : difference < 0 ? "Lower" : "Same";
        const score = Math.max(Math.abs(percentDifference), Math.abs(difference) / 20);

        rows.push({
          location,
          type,
          currentPrice: currentDominant.price,
          currentTickets,
          currentPrices: currentPriceMap,
          currentPricesText: exactPriceLabel(currentPriceMap),
          historicalAverage: historical.averagePrice,
          historicalMedian: historical.medianPrice,
          historicalMin: historical.minimumPrice,
          historicalMax: historical.maximumPrice,
          historicalDates: historical.dateCount,
          historicalTickets: historical.ticketCount,
          historicalPricesText: exactPriceLabel(historical.exactPrices),
          historyKeys: historical.days.map(day => day.key),
          difference,
          percentDifference,
          direction,
          isFlagged,
          confidenceLabel,
          confidenceClass,
          severityLabel,
          severityClass,
          score
        });
      });
    });

    rows.sort((a, b) =>
      Number(b.isFlagged) - Number(a.isFlagged) ||
      b.score - a.score ||
      a.location.localeCompare(b.location, undefined, { numeric: true }) ||
      typeOrder(a.type) - typeOrder(b.type)
    );
    return { rows, locationsScanned, skipped };
  }

  function render() {
    if (!hasData() || !$("outlierTableBody")) return;
    populateDate(false);
    const result = analyze();
    lastRows = result.rows;

    const flaggedRows = result.rows.filter(row => row.isFlagged);
    const flaggedLocations = new Set(flaggedRows.map(row => row.location));
    $("outlierLocationsScanned").textContent = result.locationsScanned.toLocaleString();
    $("outlierFlaggedLocations").textContent = flaggedLocations.size.toLocaleString();
    $("outlierFlaggedOptions").textContent = flaggedRows.length.toLocaleString();
    $("outlierLargestDifference").textContent = flaggedRows.length
      ? `${flaggedRows[0].difference >= 0 ? "+" : "−"}${cash(Math.abs(flaggedRows[0].difference))}`
      : "--";

    const notice = $("outlierNotice");
    const minimumDollars = Number($("outlierDollarThreshold")?.value || 5);
    const minimumPercent = Number($("outlierPercentThreshold")?.value || 0.20);
    notice.className = flaggedRows.length ? "outlier-notice warning" : "outlier-notice";
    notice.textContent = flaggedRows.length
      ? `${flaggedLocations.size} location${flaggedLocations.size === 1 ? "" : "s"} have ${flaggedRows.length} ticket option${flaggedRows.length === 1 ? "" : "s"} at least ${cash(minimumDollars)} and ${Math.round(minimumPercent * 100)}% away from their historical average. Prices are compared within the same ticket option, using comparable-demand dates for each location.`
      : `No current ticket option is at least ${cash(minimumDollars)} and ${Math.round(minimumPercent * 100)}% away from its historical average. ${result.skipped} option${result.skipped === 1 ? "" : "s"} lacked enough history.`;

    const body = $("outlierTableBody");
    if (!result.rows.length) {
      body.innerHTML = `<tr><td colspan="10">No price differences meet the selected filters, or no locations have paid tickets on this date.</td></tr>`;
      return;
    }

    body.innerHTML = result.rows.map(row => `
      <tr class="${row.isFlagged ? `outlier-row ${row.severityClass}` : ""}">
        <td><strong>${esc(row.location)}</strong></td>
        <td><strong>${esc(row.type)}</strong></td>
        <td>${priceChips(row.currentPrices)}<span class="forecast-subtext">Dominant: ${cash(row.currentPrice)} · ${row.currentTickets} ticket${row.currentTickets === 1 ? "" : "s"}</span></td>
        <td><strong>${cash(row.historicalAverage)}</strong><span class="forecast-subtext">Median ${cash(row.historicalMedian)} · range ${cash(row.historicalMin)}–${cash(row.historicalMax)}</span></td>
        <td><strong class="${row.direction === "Higher" ? "price-up" : row.direction === "Lower" ? "price-down" : ""}">${row.difference >= 0 ? "+" : "−"}${cash(Math.abs(row.difference))}</strong><span class="forecast-subtext">${row.percentDifference >= 0 ? "+" : "−"}${Math.abs(row.percentDifference * 100).toFixed(0)}%</span></td>
        <td><span class="outlier-direction ${row.direction.toLowerCase()}">${row.direction}</span></td>
        <td>${row.historicalDates}<span class="forecast-subtext">${row.historicalTickets} tickets</span></td>
        <td><span class="confidence-badge ${row.confidenceClass}">${row.confidenceLabel}</span></td>
        <td><span class="outlier-severity ${row.severityClass}">${row.isFlagged ? row.severityLabel : "Within range"}</span></td>
        <td><details class="outlier-details"><summary>History</summary><div class="outlier-history-text"><strong>Prices:</strong> ${esc(row.historicalPricesText)}<br><strong>Dates:</strong> ${esc(row.historyKeys.join(", "))}</div></details></td>
      </tr>`).join("");
  }

  function populateDate(reset) {
    if (!hasData() || !$("outlierDate")) return;
    const basis = $("outlierBasis")?.value || "transaction";
    const dates = [...new Set(state.records
      .filter(validPaid)
      .map(record => recordTime(record, basis))
      .filter(Boolean)
      .map(dateKey))]
      .sort();
    const input = $("outlierDate");
    if (!dates.length) {
      input.value = "";
      return;
    }
    input.min = dates[0];
    input.max = dates.at(-1);
    if (reset || !dates.includes(input.value)) input.value = dates.at(-1);
  }

  function downloadReport() {
    if (!lastRows.length) return;
    const rows = lastRows.map(row => ({
      date: $("outlierDate")?.value || "",
      location: row.location,
      ticket_option: row.type,
      current_dominant_price: row.currentPrice.toFixed(2),
      current_exact_prices: row.currentPricesText,
      current_tickets: row.currentTickets,
      historical_average_price: row.historicalAverage.toFixed(2),
      historical_median_price: row.historicalMedian.toFixed(2),
      historical_min_price: row.historicalMin.toFixed(2),
      historical_max_price: row.historicalMax.toFixed(2),
      difference_dollars: row.difference.toFixed(2),
      difference_percent: (row.percentDifference * 100).toFixed(1),
      direction: row.direction,
      historical_dates: row.historicalDates,
      historical_tickets: row.historicalTickets,
      confidence: row.confidenceLabel,
      severity: row.isFlagged ? row.severityLabel : "Within range",
      dates_used: row.historyKeys.join("; ")
    }));
    if (typeof downloadCsv === "function") downloadCsv(rows, "location_price_outliers.csv");
  }

  function createUi() {
    if ($("outlierPageBtn")) return;
    const tabs = $("pageTabs");
    const tab = document.createElement("button");
    tab.id = "outlierPageBtn";
    tab.className = "page-tab";
    tab.type = "button";
    tab.textContent = "Price outliers";
    tabs.appendChild(tab);

    const page = document.createElement("section");
    page.id = "outlierPage";
    page.className = "main-panel outlier-page hidden";
    page.innerHTML = `
      <div class="chart-topline">
        <div>
          <h2 class="chart-title">Location price outliers</h2>
          <p class="chart-note">Find ticket options whose current paid price is far above or below that location’s historical price for comparable-demand dates.</p>
        </div>
        <div class="mini-actions"><button id="downloadOutlierBtn" class="secondary-btn" type="button">Download CSV</button></div>
      </div>
      <div class="outlier-filter-grid">
        <div><label class="control-label" for="outlierDate">Price date</label><input id="outlierDate" type="date"></div>
        <div><label class="control-label" for="outlierBasis">Date based on</label><select id="outlierBasis"><option value="transaction">Transaction Time</option><option value="entry">Entry Time</option></select></div>
        <div><label class="control-label" for="outlierComparisonMode">Historical weekdays</label><select id="outlierComparisonMode"><option value="same">Same weekday only</option><option value="auto" selected>Similar-demand weekdays</option></select></div>
        <div><label class="control-label" for="outlierDemandTolerance">Demand range</label><select id="outlierDemandTolerance"><option value="0.10">Within 10%</option><option value="0.15">Within 15%</option><option value="0.20" selected>Within 20%</option><option value="0.25">Within 25%</option></select></div>
        <div><label class="control-label" for="outlierHistoryCount">Days per weekday</label><select id="outlierHistoryCount"><option value="4">4 days</option><option value="6" selected>6 days</option><option value="8">8 days</option><option value="12">12 days</option></select></div>
        <div><label class="control-label" for="outlierDollarThreshold">Minimum dollar difference</label><select id="outlierDollarThreshold"><option value="5" selected>$5</option><option value="10">$10</option><option value="15">$15</option></select></div>
        <div><label class="control-label" for="outlierPercentThreshold">Minimum percentage difference</label><select id="outlierPercentThreshold"><option value="0.15">15%</option><option value="0.20" selected>20%</option><option value="0.30">30%</option><option value="0.40">40%</option></select></div>
        <div><label class="control-label" for="outlierShowMode">Rows shown</label><select id="outlierShowMode"><option value="flagged" selected>Flagged differences only</option><option value="all">All price comparisons</option></select></div>
      </div>
      <div class="metrics">
        <div class="metric"><span class="metric-label">Locations scanned</span><span id="outlierLocationsScanned" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Flagged locations</span><span id="outlierFlaggedLocations" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Flagged options</span><span id="outlierFlaggedOptions" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Largest difference</span><span id="outlierLargestDifference" class="metric-value">--</span></div>
      </div>
      <div id="outlierNotice" class="outlier-notice">Upload data to scan current prices.</div>
      <div class="table-wrap">
        <table class="clean-table outlier-table">
          <thead><tr>
            <th>Location</th><th>Ticket option</th><th>Current prices</th><th>Historical price</th><th>Difference</th><th>Direction</th><th>History</th><th>Confidence</th><th>Severity</th><th>Details</th>
          </tr></thead>
          <tbody id="outlierTableBody"><tr><td colspan="10">Upload data to scan location prices.</td></tr></tbody>
        </table>
      </div>`;
    document.querySelector("main.page").appendChild(page);

    tab.addEventListener("click", () => {
      ["dashboard", "nowPage", "typePage", "forecastPage"].forEach(id => $(id)?.classList.add("hidden"));
      $("outlierPage").classList.remove("hidden");
      document.querySelectorAll("#pageTabs .page-tab").forEach(button => button.classList.remove("active"));
      tab.classList.add("active");
      populateDate(false);
      render();
    });

    tabs.addEventListener("click", event => {
      if (event.target?.id !== "outlierPageBtn") {
        $("outlierPage")?.classList.add("hidden");
        $("outlierPageBtn")?.classList.remove("active");
      }
    });

    [
      "outlierDate",
      "outlierComparisonMode",
      "outlierDemandTolerance",
      "outlierHistoryCount",
      "outlierDollarThreshold",
      "outlierPercentThreshold",
      "outlierShowMode"
    ].forEach(id => $(id).addEventListener("change", render));
    $("outlierBasis").addEventListener("change", () => {
      populateDate(true);
      render();
    });
    $("downloadOutlierBtn").addEventListener("click", downloadReport);
  }

  function initialize() {
    createUi();
    if (hasData()) {
      populateDate(true);
      render();
    }
    document.addEventListener("parking-data-updated", () => {
      populateDate(true);
      render();
    });
    new MutationObserver(() => {
      if (hasData()) {
        populateDate(false);
        if (!$("outlierPage")?.classList.contains("hidden")) render();
      }
    }).observe($("statusCard"), { childList: true, characterData: true, subtree: true });
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", initialize)
    : initialize();
})();
