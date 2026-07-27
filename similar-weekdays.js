(() => {
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cash = value => Number.isFinite(Number(value)) ? money.format(Number(value)) : "--";
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  let rendering = false;

  function hasData() {
    return typeof state !== "undefined" && Array.isArray(state.records) && state.records.length > 0;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function previousYearKey(key) {
    const date = ParkingComparison.parseKey(key);
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

  function selectedRecords(basis, location) {
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
    return {
      key,
      tickets: records.length,
      total,
      through,
      after: total - through,
      options: [...optionMap.values()].sort((a, b) => a.type.localeCompare(b.type, undefined, { numeric: true }) || a.amount - b.amount)
    };
  }

  function tableRow(summary, label, full, projected, cutoff) {
    const date = ParkingComparison.parseKey(summary.key);
    const display = date.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
    const options = summary.options.length
      ? `<div class="forecast-option-list">${summary.options.map(option => `<span class="forecast-option-chip">${esc(option.type)} · ${cash(option.amount)} × ${option.count.toLocaleString()}</span>`).join("")}</div>`
      : `<span class="forecast-empty">No paid ticket options found</span>`;
    return `<tr><td><strong>${esc(display)}</strong><span class="forecast-subtext">${summary.key}</span></td><td>${esc(label)}</td><td>${summary.tickets.toLocaleString()}</td><td>${cash(summary.through)}<span class="forecast-subtext">through ${cutoffLabel(cutoff)}</span></td><td>${full === null ? "--" : cash(full)}${projected ? `<span class="forecast-projected">Projected</span>` : ""}</td><td>${options}</td></tr>`;
  }

  function addControls() {
    if ($("forecastComparisonMode")) return;
    const grid = document.querySelector(".forecast-filter-grid");
    if (!grid) return;

    const modeWrap = document.createElement("div");
    modeWrap.innerHTML = `<label class="control-label" for="forecastComparisonMode">Comparison weekdays</label><select id="forecastComparisonMode"><option value="same">Same weekday only</option><option value="auto" selected>Automatically include similar weekdays</option></select>`;
    grid.appendChild(modeWrap);

    const toleranceWrap = document.createElement("div");
    toleranceWrap.id = "forecastToleranceWrap";
    toleranceWrap.innerHTML = `<label class="control-label" for="forecastDemandTolerance">Similar-demand range</label><select id="forecastDemandTolerance"><option value="0.10">Within 10%</option><option value="0.15" selected>Within 15%</option><option value="0.20">Within 20%</option><option value="0.25">Within 25%</option></select>`;
    grid.appendChild(toleranceWrap);

    const countLabel = document.querySelector('label[for="forecastWeekdayCount"]');
    if (countLabel) countLabel.textContent = "Days per included weekday";

    ["forecastComparisonMode", "forecastDemandTolerance"].forEach(id => $(id).addEventListener("change", () => {
      $("forecastToleranceWrap").classList.toggle("hidden", $("forecastComparisonMode").value !== "auto");
      render();
    }));
  }

  function recommendable(type) {
    const text = String(type || "").toLowerCase();
    return Boolean(text) && !text.includes("extension") && !text.includes("unknown") && !text.includes("monthly") && !text.includes("event");
  }

  function optionRows(records) {
    const map = new Map();
    records.forEach(record => {
      const type = typeof classifyTicketType === "function" ? classifyTicketType(record) : (record.ticketType || "Unknown / other");
      if (!recommendable(type) || record.amount <= 0) return;
      const key = `${type}\u0000${Number(record.amount).toFixed(2)}`;
      if (!map.has(key)) map.set(key, { type, amount: record.amount, count: 0 });
      map.get(key).count += 1;
    });
    return [...map.values()];
  }

  function renderPricing(byDate, historyKeys, targetKey, location) {
    const body = $("priceRecommendationBody");
    const notice = $("priceRecommendationNotice");
    if (!body || !notice || location === "all") return;

    const types = new Map();
    historyKeys.forEach(dayKey => {
      optionRows(byDate.get(dayKey) || []).forEach(option => {
        if (!types.has(option.type)) types.set(option.type, new Map());
        const prices = types.get(option.type);
        const price = Number(option.amount).toFixed(2);
        if (!prices.has(price)) prices.set(price, { amount: option.amount, tickets: 0, revenue: 0, days: new Set() });
        const row = prices.get(price);
        row.tickets += option.count;
        row.revenue += option.amount * option.count;
        row.days.add(dayKey);
      });
    });

    const observed = new Map();
    optionRows(byDate.get(targetKey) || []).forEach(option => {
      if (!observed.has(option.type)) observed.set(option.type, []);
      observed.get(option.type).push(option);
    });

    const rows = [...types.entries()].map(([type, prices]) => {
      const candidates = [...prices.values()].map(row => ({
        ...row,
        dayCount: row.days.size,
        dailyRevenue: row.revenue / row.days.size,
        dailyTickets: row.tickets / row.days.size
      })).sort((a, b) => b.dailyRevenue - a.dailyRevenue || b.dayCount - a.dayCount || b.tickets - a.tickets || b.amount - a.amount);
      return { type, candidates, best: candidates[0], observed: observed.get(type) || [] };
    }).sort((a, b) => a.type.localeCompare(b.type, undefined, { numeric: true }));

    notice.className = "recommendation-notice";
    notice.textContent = `Recommendations use ${historyKeys.length} comparison dates across the included similar-demand weekdays. Prices are ranked by average revenue per day on dates when that exact price sold.`;
    body.innerHTML = rows.map(row => {
      const primary = [...row.observed].sort((a, b) => b.count - a.count)[0] || null;
      const current = primary ? row.candidates.find(candidate => Number(candidate.amount).toFixed(2) === Number(primary.amount).toFixed(2)) : null;
      const delta = current ? row.best.dailyRevenue - current.dailyRevenue : null;
      const confidence = row.best.dayCount >= 4 && row.best.tickets >= 20 ? ["High", "high"] : row.best.dayCount >= 2 && row.best.tickets >= 8 ? ["Medium", "medium"] : ["Low", "low"];
      const observedHtml = row.observed.length ? `<div class="observed-price-list">${row.observed.map(item => `<span class="observed-price-chip">${cash(item.amount)} × ${item.count}</span>`).join("")}</div>` : `<span class="forecast-empty">Not observed yet</span>`;
      const change = !primary ? `<span class="forecast-empty">No selected-date price</span>` : Number(primary.amount).toFixed(2) === Number(row.best.amount).toFixed(2) ? `<strong>Keep ${cash(primary.amount)}</strong>` : `<strong>${cash(primary.amount)} → ${cash(row.best.amount)}</strong><span class="forecast-subtext">${delta === null ? "No baseline" : `${delta >= 0 ? "+" : "−"}${cash(Math.abs(delta))} revenue/tested day`}</span>`;
      const tests = `<div class="price-test-list">${[...row.candidates].sort((a, b) => a.amount - b.amount).map(candidate => `<span class="price-test-chip ${candidate === row.best ? "recommended" : ""}"><strong>${cash(candidate.amount)}</strong> · ${cash(candidate.dailyRevenue)}/day · ${candidate.dailyTickets.toFixed(1)} cars · ${candidate.dayCount} days</span>`).join("")}</div>`;
      return `<tr><td><strong>${esc(row.type)}</strong></td><td>${observedHtml}</td><td><span class="recommended-price">${cash(row.best.amount)}</span></td><td><strong>${cash(row.best.dailyRevenue)}</strong><span class="forecast-subtext">${cash(row.best.revenue)} total</span></td><td>${row.best.dailyTickets.toFixed(1)}<span class="forecast-subtext">${row.best.tickets} total</span></td><td>${row.best.dayCount}</td><td>${change}</td><td><span class="confidence-badge ${confidence[1]}">${confidence[0]}</span></td><td>${tests}</td></tr>`;
    }).join("");
  }

  function render() {
    if (rendering || !hasData() || !$(("forecastDate"))) return;
    rendering = true;
    try {
      addControls();
      const targetKey = $("forecastDate").value;
      const basis = $("forecastTimeBasis").value;
      const location = $("forecastLocation").value || "all";
      const perWeekdayCount = Number($("forecastWeekdayCount").value || 4);
      const mode = $("forecastComparisonMode")?.value || "same";
      const tolerance = Number($("forecastDemandTolerance")?.value || 0.15);
      if (!targetKey) return;

      const byDate = groupByDate(selectedRecords(basis, location), basis);
      const targetRecords = byDate.get(targetKey) || [];
      const live = targetKey === dateKey(new Date());
      let cutoff = 1439;
      if (live) {
        const minutes = targetRecords.map(record => minute(revenueTime(record, basis)));
        cutoff = minutes.length ? Math.max(...minutes) : minute(new Date());
      }

      const target = summarize(targetKey, targetRecords, basis, cutoff);
      const priorKey = previousYearKey(targetKey);
      const prior = priorKey && byDate.has(priorKey) ? summarize(priorKey, byDate.get(priorKey), basis, cutoff) : null;
      const context = ParkingComparison.build({ byDate, targetKey, perWeekdayCount, mode, tolerance, excludeKey: priorKey });
      const comparisonDays = context.keys.map(key => summarize(key, byDate.get(key), basis, cutoff));
      const remaining = average(comparisonDays.map(day => day.after));
      const expectedRemaining = average([prior?.after, remaining]);
      const projected = live ? (expectedRemaining === null ? null : target.through + expectedRemaining) : target.total;

      $("forecastProjected").textContent = projected === null ? "--" : cash(projected);
      $("forecastCollected").textContent = cash(target.through);
      $("forecastPriorYear").textContent = prior ? cash(prior.total) : "--";
      $("forecastWeekdayAverage").textContent = comparisonDays.length ? cash(average(comparisonDays.map(day => day.total))) : "--";
      const metricLabel = $("forecastWeekdayAverage")?.previousElementSibling;
      if (metricLabel) metricLabel.textContent = mode === "auto" ? "Comparable weekday average" : "Prior weekday average";

      const method = $("forecastMethod");
      const description = ParkingComparison.describe(context);
      if (live && expectedRemaining !== null) {
        method.className = "forecast-method";
        method.textContent = `Projection uses actual revenue through ${cutoffLabel(cutoff)}, then adds average revenue after that time from ${prior ? `the same date last year and ` : ""}${comparisonDays.length} comparable weekday dates. ${description}`;
      } else if (!live) {
        method.className = "forecast-method";
        method.textContent = `${targetKey} is complete, so its actual full-day revenue is shown. ${description}`;
      } else {
        method.className = "forecast-method warning";
        method.textContent = `Not enough comparison data to forecast the rest of the day. ${description}`;
      }

      const rows = [tableRow(target, live ? "Selected date · in progress" : "Selected date · actual", projected, live, cutoff)];
      if (prior) rows.push(tableRow(prior, "Same calendar date last year", prior.total, false, cutoff));
      comparisonDays.forEach(day => {
        const dayName = ParkingComparison.parseKey(day.key).toLocaleDateString("en-US", { weekday: "long" });
        rows.push(tableRow(day, mode === "auto" ? `Comparable ${dayName}` : `Previous ${dayName}`, day.total, false, cutoff));
      });
      $("forecastTableBody").innerHTML = rows.join("");

      const historyKeys = [prior ? prior.key : null, ...context.keys].filter(Boolean);
      renderPricing(byDate, historyKeys, targetKey, location);
    } finally {
      rendering = false;
    }
  }

  function initialize() {
    if (!$(("forecastPage"))) return;
    addControls();
    ["forecastDate", "forecastLocation", "forecastTimeBasis", "forecastWeekdayCount"].forEach(id => $(id)?.addEventListener("change", () => setTimeout(render, 20)));
    new MutationObserver(() => {
      if (!rendering && hasData()) setTimeout(render, 30);
    }).observe($("statusCard"), { childList: true, characterData: true, subtree: true });
    $("forecastPageBtn")?.addEventListener("click", () => setTimeout(render, 20));
  }

  initialize();
})();
