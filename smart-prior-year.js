(() => {
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const cash = value => Number.isFinite(Number(value)) ? money.format(Number(value)) : "--";
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  let applying = false;

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseKey(key) {
    return window.ParkingComparison?.parseKey ? ParkingComparison.parseKey(key) : null;
  }

  function priorYearKey(targetKey) {
    const target = parseKey(targetKey);
    if (!target) return null;
    const prior = new Date(target.getFullYear() - 1, target.getMonth(), target.getDate(), 12);
    return prior.getMonth() === target.getMonth() && prior.getDate() === target.getDate() ? dateKey(prior) : null;
  }

  function revenueTime(record, basis) {
    return basis === "entry" ? record.entryDateObj : (record.paymentDateObj || record.entryDateObj);
  }

  function valid(record) {
    if (record.amount === null || !Number.isFinite(record.amount)) return false;
    const status = String(record.ticketStatus || "").toLowerCase();
    return !status.includes("cancel") && !status.includes("void") && !status.includes("refund");
  }

  function selectedRecords(basis, location) {
    return state.records.filter(record => valid(record) && (location === "all" || record.location === location) && revenueTime(record, basis));
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

  function minute(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  function average(values) {
    const validValues = values.filter(Number.isFinite);
    return validValues.length ? validValues.reduce((sum, value) => sum + value, 0) / validValues.length : null;
  }

  function comparisonKeysFromTable(targetKey, priorKey) {
    return [...document.querySelectorAll("#forecastTableBody tr")]
      .map(row => row.querySelector("td:first-child .forecast-subtext")?.textContent?.trim())
      .filter(key => key && key !== targetKey && key !== priorKey);
  }

  function priorDecision(byDate, targetKey, priorKey) {
    if (!priorKey || !byDate.has(priorKey)) return { include: false, reason: "No same calendar date last year is available." };
    const target = parseKey(targetKey);
    const prior = parseKey(priorKey);
    if (!target || !prior) return { include: true, reason: "" };
    if (target.getDay() === prior.getDay()) return { include: true, reason: "Same weekday as the selected date." };

    const mode = $("forecastComparisonMode")?.value || "auto";
    const tolerance = Number($("forecastDemandTolerance")?.value || 0.15);
    const perWeekdayCount = Number($("forecastWeekdayCount")?.value || 4);
    const context = window.ParkingComparison?.build
      ? ParkingComparison.build({ byDate, targetKey, perWeekdayCount, mode, tolerance, excludeKey: priorKey })
      : null;
    const typicalDemand = context?.targetMedian;
    const priorDemand = (byDate.get(priorKey) || []).length;

    if (!Number.isFinite(typicalDemand) || typicalDemand <= 0) {
      return { include: true, reason: "Not enough weekday history to judge the prior-year date." };
    }

    const difference = Math.abs(priorDemand - typicalDemand) / typicalDemand;
    const include = difference <= tolerance;
    const targetDay = target.toLocaleDateString("en-US", { weekday: "long" });
    const priorDay = prior.toLocaleDateString("en-US", { weekday: "long" });
    return {
      include,
      reason: include
        ? `${priorKey} was a ${priorDay}, but its ${priorDemand} paid tickets were within ${Math.round(tolerance * 100)}% of the typical ${targetDay} demand (${Number(typicalDemand).toFixed(1)}).`
        : `${priorKey} was a ${priorDay} with ${priorDemand} paid tickets, ${Math.round(difference * 100)}% different from typical ${targetDay} demand (${Number(typicalDemand).toFixed(1)}), so it was excluded.`
    };
  }

  function typeFor(record) {
    return typeof classifyTicketType === "function" ? classifyTicketType(record) : (record.ticketType || "Unknown / other");
  }

  function recommendable(type) {
    const text = String(type || "").toLowerCase();
    return text && !text.includes("extension") && !text.includes("unknown") && !text.includes("monthly") && !text.includes("event");
  }

  function optionRows(records) {
    const map = new Map();
    records.forEach(record => {
      const type = typeFor(record);
      if (!recommendable(type) || record.amount <= 0) return;
      const key = `${type}\u0000${Number(record.amount).toFixed(2)}`;
      if (!map.has(key)) map.set(key, { type, amount: record.amount, count: 0 });
      map.get(key).count += 1;
    });
    return [...map.values()];
  }

  function typeOrder(type) {
    const text = String(type).toLowerCase();
    const hours = text.match(/^(\d+(?:\.\d+)?)h$/);
    if (hours) return Number(hours[1]);
    if (text.includes("all day")) return 50;
    if (text.includes("overnight")) return 60;
    return 40;
  }

  function renderPricing(byDate, historyKeys, targetKey) {
    const body = $("priceRecommendationBody");
    const notice = $("priceRecommendationNotice");
    if (!body || !notice) return;
    const types = new Map();

    historyKeys.forEach(dayKey => {
      optionRows(byDate.get(dayKey) || []).forEach(option => {
        if (!types.has(option.type)) types.set(option.type, new Map());
        const prices = types.get(option.type);
        const priceKey = Number(option.amount).toFixed(2);
        if (!prices.has(priceKey)) prices.set(priceKey, { amount: option.amount, tickets: 0, revenue: 0, days: new Set() });
        const row = prices.get(priceKey);
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
    }).sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.type.localeCompare(b.type, undefined, { numeric: true }));

    notice.className = "recommendation-notice";
    notice.textContent = `Recommendations use ${historyKeys.length} accepted historical comparison dates. A prior-year date on a different weekday is excluded when its demand differs from typical demand by more than the selected similar-demand range.`;

    body.innerHTML = rows.map(row => {
      const primary = [...row.observed].sort((a, b) => b.count - a.count)[0] || null;
      const current = primary ? row.candidates.find(candidate => Number(candidate.amount).toFixed(2) === Number(primary.amount).toFixed(2)) : null;
      const delta = current ? row.best.dailyRevenue - current.dailyRevenue : null;
      const confidence = row.best.dayCount >= 4 && row.best.tickets >= 20 ? ["High", "high"] : row.best.dayCount >= 2 && row.best.tickets >= 8 ? ["Medium", "medium"] : ["Low", "low"];
      const observedHtml = row.observed.length ? `<div class="observed-price-list">${row.observed.map(item => `<span class="observed-price-chip">${cash(item.amount)} × ${item.count}</span>`).join("")}</div>` : `<span class="forecast-empty">Not observed yet</span>`;
      const change = !primary ? `<span class="forecast-empty">No selected-date price</span>` : Number(primary.amount).toFixed(2) === Number(row.best.amount).toFixed(2) ? `<strong>Keep ${cash(primary.amount)}</strong>` : `<strong>${cash(primary.amount)} → ${cash(row.best.amount)}</strong><span class="forecast-subtext">${delta === null ? "No baseline" : `${delta >= 0 ? "+" : "−"}${cash(Math.abs(delta))} revenue/observed-price day`}</span>`;
      const tests = `<div class="price-test-list">${row.candidates.sort((a, b) => a.amount - b.amount).map(candidate => `<span class="price-test-chip ${candidate === row.best ? "recommended" : ""}"><strong>${cash(candidate.amount)}</strong> · ${cash(candidate.dailyRevenue)}/day · ${candidate.dailyTickets.toFixed(1)} cars · observed ${candidate.dayCount}/${historyKeys.length} dates</span>`).join("")}</div>`;
      return `<tr><td><strong>${esc(row.type)}</strong></td><td>${observedHtml}</td><td><span class="recommended-price">${cash(row.best.amount)}</span></td><td><strong>${cash(row.best.dailyRevenue)}</strong><span class="forecast-subtext">${cash(row.best.revenue)} total</span></td><td>${row.best.dailyTickets.toFixed(1)}<span class="forecast-subtext">${row.best.tickets} total</span></td><td><strong>${row.best.dayCount} of ${historyKeys.length}</strong></td><td>${change}</td><td><span class="confidence-badge ${confidence[1]}">${confidence[0]}</span></td><td>${tests}</td></tr>`;
    }).join("");
  }

  function apply() {
    if (applying || !window.state?.records?.length || !$("forecastDate") || !$("forecastTableBody")) return;
    applying = true;
    try {
      const targetKey = $("forecastDate").value;
      const location = $("forecastLocation").value || "all";
      const basis = $("forecastTimeBasis").value || "transaction";
      if (!targetKey || location === "all") return;
      const byDate = groupByDate(selectedRecords(basis, location), basis);
      const priorKey = priorYearKey(targetKey);
      const decision = priorDecision(byDate, targetKey, priorKey);
      if (decision.include) return;

      const priorRow = [...document.querySelectorAll("#forecastTableBody tr")].find(row => row.querySelector("td:first-child .forecast-subtext")?.textContent?.trim() === priorKey);
      priorRow?.remove();
      const comparisonKeys = comparisonKeysFromTable(targetKey, priorKey);
      const targetRecords = byDate.get(targetKey) || [];
      const live = targetKey === dateKey(new Date());
      const cutoff = live
        ? (targetRecords.length ? targetRecords.map(record => minute(revenueTime(record, basis))).reduce((max, value) => Math.max(max, value), 0) : minute(new Date()))
        : 1439;
      const targetThrough = targetRecords.reduce((sum, record) => sum + (minute(revenueTime(record, basis)) <= cutoff ? record.amount : 0), 0);
      const remaining = comparisonKeys.map(key => (byDate.get(key) || []).reduce((sum, record) => sum + (minute(revenueTime(record, basis)) > cutoff ? record.amount : 0), 0));
      const expectedRemaining = average(remaining);
      if (live && expectedRemaining !== null) $("forecastProjected").textContent = cash(targetThrough + expectedRemaining);
      $("forecastPriorYear").textContent = "Excluded";
      const label = $("forecastPriorYear").previousElementSibling;
      if (label) label.textContent = "Prior-year date";
      const method = $("forecastMethod");
      if (method && !method.textContent.includes("was excluded")) method.textContent = `${method.textContent} ${decision.reason}`;
      renderPricing(byDate, comparisonKeys, targetKey);
    } finally {
      applying = false;
    }
  }

  function schedule() {
    setTimeout(apply, 80);
  }

  document.addEventListener("parking-data-updated", schedule);
  ["forecastDate", "forecastLocation", "forecastTimeBasis", "forecastWeekdayCount", "forecastComparisonMode", "forecastDemandTolerance"].forEach(id => {
    document.addEventListener("change", event => {
      if (event.target?.id === id) schedule();
    });
  });
  const observer = new MutationObserver(() => {
    if (!applying) schedule();
  });
  const start = () => {
    if ($("forecastTableBody")) observer.observe($("forecastTableBody"), { childList: true });
    schedule();
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", start) : start();
})();
