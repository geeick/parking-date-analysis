(() => {
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const cash = value => Number.isFinite(Number(value)) ? money.format(Number(value)) : "--";
  const hasData = () => typeof state !== "undefined" && Array.isArray(state.records) && state.records.length > 0;

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseKey(key) {
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(+match[1], +match[2] - 1, +match[3], 12) : null;
  }

  function previousYearKey(key) {
    const date = parseKey(key);
    if (!date) return null;
    const previous = new Date(date.getFullYear() - 1, date.getMonth(), date.getDate(), 12);
    return previous.getMonth() === date.getMonth() && previous.getDate() === date.getDate() ? dateKey(previous) : null;
  }

  function revenueTime(record, basis) {
    return basis === "entry" ? record.entryDateObj : (record.paymentDateObj || record.entryDateObj);
  }

  function validRevenue(record) {
    if (record.amount === null || !Number.isFinite(record.amount)) return false;
    const status = String(record.ticketStatus || "").toLowerCase();
    return !status.includes("cancel") && !status.includes("void") && !status.includes("refund");
  }

  function minute(date) { return date.getHours() * 60 + date.getMinutes(); }

  function cutoffLabel(value) {
    const hour24 = Math.floor(value / 60);
    return `${hour24 % 12 || 12}:${String(value % 60).padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`;
  }

  function average(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
  }

  function createUi() {
    if ($("forecastPageBtn")) return;
    const tab = document.createElement("button");
    tab.id = "forecastPageBtn";
    tab.className = "page-tab";
    tab.type = "button";
    tab.textContent = "Today's revenue";
    $("pageTabs").appendChild(tab);

    const page = document.createElement("section");
    page.id = "forecastPage";
    page.className = "main-panel forecast-page hidden";
    page.innerHTML = `
      <div class="chart-topline"><div><h2 class="chart-title">Today's revenue forecast</h2><p class="chart-note">Estimate the selected day's total revenue from the same calendar date last year and recent matching weekdays. Exact ticket types and prices are shown for every comparison date.</p></div></div>
      <div class="forecast-filter-grid">
        <div><label class="control-label" for="forecastDate">Forecast date</label><input id="forecastDate" type="date"></div>
        <div><label class="control-label" for="forecastLocation">Location</label><select id="forecastLocation"><option value="all">All locations</option></select></div>
        <div><label class="control-label" for="forecastTimeBasis">Revenue date based on</label><select id="forecastTimeBasis"><option value="transaction">Transaction Time</option><option value="entry">Entry Time</option></select></div>
        <div><label class="control-label" for="forecastWeekdayCount">Previous same weekdays</label><select id="forecastWeekdayCount"><option value="2">Previous 2</option><option value="4" selected>Previous 4</option><option value="6">Previous 6</option><option value="8">Previous 8</option></select></div>
      </div>
      <div class="metrics">
        <div class="metric"><span class="metric-label">Projected full day</span><span id="forecastProjected" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Collected through cutoff</span><span id="forecastCollected" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Same date last year</span><span id="forecastPriorYear" class="metric-value">--</span></div>
        <div class="metric"><span class="metric-label">Prior weekday average</span><span id="forecastWeekdayAverage" class="metric-value">--</span></div>
      </div>
      <div id="forecastMethod" class="forecast-method">Upload a CSV to calculate the forecast.</div>
      <div class="table-wrap"><table class="clean-table forecast-table"><thead><tr><th>Date</th><th>Used as</th><th>Paid tickets</th><th>Revenue through cutoff</th><th>Full-day revenue</th><th>Ticket options and exact prices paid</th></tr></thead><tbody id="forecastTableBody"><tr><td colspan="6">Upload a CSV to calculate today's expected revenue.</td></tr></tbody></table></div>`;
    document.querySelector("main.page").appendChild(page);

    tab.addEventListener("click", showPage);
    ["hourlyPageBtn", "nowPageBtn", "typePageBtn"].forEach(id => $(id)?.addEventListener("click", hidePage));
    $("forecastDate").addEventListener("change", render);
    $("forecastWeekdayCount").addEventListener("change", render);
    ["forecastLocation", "forecastTimeBasis"].forEach(id => $(id).addEventListener("change", () => { populate(true); render(); }));

    new MutationObserver(() => {
      if (hasData()) { populate(true); render(); }
    }).observe($("statusCard"), { childList: true, characterData: true, subtree: true });
  }

  function showPage() {
    ["dashboard", "nowPage", "typePage"].forEach(id => $(id)?.classList.add("hidden"));
    $("forecastPage").classList.remove("hidden");
    ["hourlyPageBtn", "nowPageBtn", "typePageBtn"].forEach(id => $(id)?.classList.remove("active"));
    $("forecastPageBtn").classList.add("active");
    populate(false);
    render();
  }

  function hidePage() {
    $("forecastPage")?.classList.add("hidden");
    $("forecastPageBtn")?.classList.remove("active");
  }

  function populate(resetDate) {
    if (!hasData()) return;
    const basis = $("forecastTimeBasis").value;
    const locationSelect = $("forecastLocation");
    const oldLocation = locationSelect.value || "all";
    const locations = [...new Set(state.records.map(record => record.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    locationSelect.innerHTML = `<option value="all">All locations</option>${locations.map(location => `<option value="${esc(location)}">${esc(location)}</option>`).join("")}`;
    if (locations.includes(oldLocation)) locationSelect.value = oldLocation;

    const location = locationSelect.value || "all";
    const dates = [...new Set(state.records.filter(record => validRevenue(record) && (location === "all" || record.location === location)).map(record => revenueTime(record, basis)).filter(Boolean).map(dateKey))].sort();
    const input = $("forecastDate");
    if (!dates.length) { input.value = ""; return; }
    input.min = dates[0];
    input.max = dates.at(-1);
    if (resetDate || !dates.includes(input.value)) input.value = dates.at(-1);
  }

  function selectedRecords() {
    const basis = $("forecastTimeBasis").value;
    const location = $("forecastLocation").value;
    return state.records.filter(record => validRevenue(record) && (location === "all" || record.location === location) && revenueTime(record, basis));
  }

  function groupByDate(records, basis) {
    const map = new Map();
    records.forEach(record => {
      const key = dateKey(revenueTime(record, basis));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    });
    return map;
  }

  function summarize(key, records, basis, cutoff) {
    let total = 0;
    let through = 0;
    const optionMap = new Map();
    records.forEach(record => {
      const time = revenueTime(record, basis);
      total += record.amount;
      if (minute(time) <= cutoff) through += record.amount;
      const type = typeof classifyTicketType === "function" ? classifyTicketType(record) : (record.ticketType || "Unknown / other");
      const optionKey = `${type}\u0000${Number(record.amount).toFixed(2)}`;
      if (!optionMap.has(optionKey)) optionMap.set(optionKey, { type, amount: record.amount, count: 0 });
      optionMap.get(optionKey).count += 1;
    });
    const options = [...optionMap.values()].sort((a, b) => a.type.localeCompare(b.type, undefined, { numeric: true }) || a.amount - b.amount);
    return { key, tickets: records.length, total, through, after: total - through, options };
  }

  function sameWeekdayKeys(keys, targetKey, count, excludeKey) {
    const target = parseKey(targetKey);
    if (!target) return [];
    return keys.filter(key => key < targetKey && key !== excludeKey && parseKey(key)?.getDay() === target.getDay()).sort((a, b) => b.localeCompare(a)).slice(0, count);
  }

  function metric(id, value) { $(id).textContent = value === null || !Number.isFinite(value) ? "--" : cash(value); }

  function render() {
    if (!hasData()) return;
    const targetKey = $("forecastDate").value;
    const basis = $("forecastTimeBasis").value;
    const count = +$("forecastWeekdayCount").value;
    const byDate = groupByDate(selectedRecords(), basis);
    const keys = [...byDate.keys()].sort();
    if (!targetKey) return;

    const live = targetKey === dateKey(new Date());
    const targetRecords = byDate.get(targetKey) || [];
    let cutoff = 1439;
    if (live) {
      const minutes = targetRecords.map(record => minute(revenueTime(record, basis)));
      cutoff = minutes.length ? minutes.reduce((max, value) => Math.max(max, value), 0) : minute(new Date());
    }

    const target = summarize(targetKey, targetRecords, basis, cutoff);
    const priorKey = previousYearKey(targetKey);
    const prior = priorKey && byDate.has(priorKey) ? summarize(priorKey, byDate.get(priorKey), basis, cutoff) : null;
    const weekdayKeys = sameWeekdayKeys(keys, targetKey, count, priorKey);
    const weekdays = weekdayKeys.map(key => summarize(key, byDate.get(key), basis, cutoff));
    const weekdayRemaining = average(weekdays.map(day => day.after));
    const expectedRemaining = average([prior?.after, weekdayRemaining]);
    const projected = live ? (expectedRemaining === null ? null : target.through + expectedRemaining) : target.total;
    const weekdayAverage = average(weekdays.map(day => day.total));

    metric("forecastProjected", projected);
    metric("forecastCollected", target.through);
    metric("forecastPriorYear", prior?.total ?? null);
    metric("forecastWeekdayAverage", weekdayAverage);

    const targetDate = parseKey(targetKey);
    const weekday = targetDate.toLocaleDateString("en-US", { weekday: "long" });
    const sources = [];
    if (prior) sources.push(`the same calendar date last year (${priorKey})`);
    if (weekdays.length) sources.push(`the ${weekdays.length} previous ${weekday}s`);
    const method = $("forecastMethod");
    if (live && expectedRemaining !== null) {
      method.className = "forecast-method";
      method.textContent = `Projection uses actual revenue in this CSV through ${cutoffLabel(cutoff)}, then adds the average revenue earned after that time from ${sources.join(" and ")}. The two methods are weighted equally when both are available.`;
    } else if (!live) {
      method.className = "forecast-method";
      method.textContent = `${targetKey} is a completed historical date, so the projected value is its actual full-day revenue. The other rows show its previous-year and previous-${weekday} comparisons.`;
    } else {
      method.className = "forecast-method warning";
      method.textContent = `There is not enough historical data to forecast the rest of ${targetKey}. Add the same date last year or previous ${weekday}s to the CSV.`;
    }

    const rows = [{ summary: target, label: live ? "Selected date · in progress" : "Selected date · actual", full: projected, projected: live }];
    if (prior) rows.push({ summary: prior, label: "Same calendar date last year", full: prior.total, projected: false });
    weekdays.forEach(day => rows.push({ summary: day, label: `Previous ${weekday}`, full: day.total, projected: false }));
    $("forecastTableBody").innerHTML = rows.map(row => tableRow(row, cutoff)).join("");
  }

  function tableRow(row, cutoff) {
    const date = parseKey(row.summary.key);
    const label = date.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    const options = row.summary.options.length
      ? `<div class="forecast-option-list">${row.summary.options.map(option => `<span class="forecast-option-chip">${esc(option.type)} · ${cash(option.amount)} × ${option.count.toLocaleString()}</span>`).join("")}</div>`
      : `<span class="forecast-empty">No paid ticket options found</span>`;
    return `<tr><td><strong>${esc(label)}</strong><span class="forecast-subtext">${row.summary.key}</span></td><td>${esc(row.label)}</td><td>${row.summary.tickets.toLocaleString()}</td><td>${cash(row.summary.through)}<span class="forecast-subtext">through ${cutoffLabel(cutoff)}</span></td><td>${row.full === null ? "--" : cash(row.full)}${row.projected ? `<span class="forecast-projected">Projected</span>` : ""}</td><td>${options}</td></tr>`;
  }

  createUi();
})();
