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

  function hasData() {
    return typeof state !== "undefined" && Array.isArray(state.records) && state.records.length > 0;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseKey(key) {
    if (window.ParkingComparison?.parseKey) return window.ParkingComparison.parseKey(key);
    const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? new Date(+match[1], +match[2] - 1, +match[3], 12) : null;
  }

  function previousYearKey(key) {
    const date = parseKey(key);
    if (!date) return null;
    const previous = new Date(date.getFullYear() - 1, date.getMonth(), date.getDate(), 12);
    return previous.getMonth() === date.getMonth() && previous.getDate() === date.getDate()
      ? dateKey(previous)
      : null;
  }

  function revenueTime(record, basis) {
    return basis === "entry" ? record.entryDateObj : (record.paymentDateObj || record.entryDateObj);
  }

  function validRevenue(record) {
    if (record.amount === null || !Number.isFinite(record.amount)) return false;
    const status = String(record.ticketStatus || "").toLowerCase();
    return !status.includes("cancel") && !status.includes("void") && !status.includes("refund");
  }

  function recommendable(type) {
    const text = String(type || "").toLowerCase();
    return Boolean(text) &&
      !text.includes("extension") &&
      !text.includes("unknown") &&
      !text.includes("monthly") &&
      !text.includes("event");
  }

  function ticketType(record) {
    return typeof classifyTicketType === "function"
      ? classifyTicketType(record)
      : (record.ticketType || "Unknown / other");
  }

  function typeOrder(type) {
    const text = String(type || "").toLowerCase();
    const mins = text.match(/^(\d+(?:\.\d+)?)m$/);
    if (mins) return Number(mins[1]) / 60;
    const hours = text.match(/^(\d+(?:\.\d+)?)h$/);
    if (hours) return Number(hours[1]);
    if (text.includes("all day")) return 50;
    if (text.includes("overnight")) return 60;
    return 40;
  }

  function priceKey(amount) {
    return Number(amount).toFixed(2);
  }

  function createUi() {
    if ($("priceRecommendationPanel")) return;
    const historyTable = document.querySelector(".forecast-table")?.closest(".table-wrap");
    if (!historyTable) return;

    const panel = document.createElement("section");
    panel.id = "priceRecommendationPanel";
    panel.className = "price-recommendation-panel";
    panel.innerHTML = `
      <div class="recommendation-heading">
        <h3>Best-supported historical prices</h3>
        <p>Revenue-first recommendations from the same comparison dates used by the forecast.</p>
      </div>
      <div id="priceRecommendationNotice" class="recommendation-notice">Choose one parking lot to calculate price recommendations.</div>
      <div class="table-wrap recommendation-table-wrap">
        <table class="clean-table recommendation-table">
          <thead><tr>
            <th>Ticket option</th>
            <th>Observed on selected date</th>
            <th>Recommended</th>
            <th>Avg. daily revenue</th>
            <th>Avg. tickets/day</th>
            <th>Days price observed</th>
            <th>Expected change</th>
            <th>Confidence</th>
            <th>All tested prices</th>
          </tr></thead>
          <tbody id="priceRecommendationBody"><tr><td colspan="9">Upload a CSV and choose one parking lot.</td></tr></tbody>
        </table>
      </div>`;
    historyTable.parentNode.insertBefore(panel, historyTable);

    const rerender = () => setTimeout(render, 0);
    ["forecastDate", "forecastLocation", "forecastTimeBasis", "forecastWeekdayCount"]
      .forEach(id => $(id)?.addEventListener("change", rerender));
    new MutationObserver(rerender).observe($("forecastTableBody"), { childList: true });
  }

  function selectedRecords(basis, location) {
    return state.records.filter(record =>
      validRevenue(record) &&
      (location === "all" || record.location === location) &&
      revenueTime(record, basis)
    );
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

  function fallbackComparisonKeys(byDate, targetKey, count, excludeKey) {
    const target = parseKey(targetKey);
    if (!target) return [];
    return [...byDate.keys()]
      .filter(key => key < targetKey && key !== excludeKey && parseKey(key)?.getDay() === target.getDay())
      .sort((a, b) => b.localeCompare(a))
      .slice(0, count);
  }

  function getComparisonContext(byDate, targetKey, count, priorKey) {
    const mode = $("forecastComparisonMode")?.value || "same";
    const tolerance = Number($("forecastDemandTolerance")?.value || 0.15);

    if (window.ParkingComparison?.build) {
      return window.ParkingComparison.build({
        byDate,
        targetKey,
        perWeekdayCount: count,
        mode,
        tolerance,
        excludeKey: priorKey
      });
    }

    const keys = fallbackComparisonKeys(byDate, targetKey, count, priorKey);
    const targetDay = parseKey(targetKey)?.getDay() ?? null;
    return {
      keys,
      includedDays: targetDay === null ? [] : [targetDay],
      includedDayNames: targetDay === null ? [] : [parseKey(targetKey).toLocaleDateString("en-US", { weekday: "long" })],
      mode: "same",
      tolerance
    };
  }

  function aggregateOptions(records) {
    const map = new Map();
    records.forEach(record => {
      const type = ticketType(record);
      if (!recommendable(type) || record.amount <= 0) return;
      const key = `${type}\u0000${priceKey(record.amount)}`;
      if (!map.has(key)) map.set(key, { type, amount: record.amount, count: 0 });
      map.get(key).count += 1;
    });
    return [...map.values()];
  }

  function confidence(candidate) {
    if (candidate.days >= 4 && candidate.tickets >= 20) return ["High", "high"];
    if (candidate.days >= 2 && candidate.tickets >= 8) return ["Medium", "medium"];
    return ["Low", "low"];
  }

  function buildRecommendations(byDate, historyKeys, targetKey) {
    const types = new Map();

    historyKeys.forEach(dayKey => {
      aggregateOptions(byDate.get(dayKey) || []).forEach(option => {
        if (!types.has(option.type)) types.set(option.type, new Map());
        const prices = types.get(option.type);
        const key = priceKey(option.amount);
        if (!prices.has(key)) {
          prices.set(key, {
            amount: option.amount,
            tickets: 0,
            revenue: 0,
            dayKeys: new Set()
          });
        }
        const row = prices.get(key);
        row.tickets += option.count;
        row.revenue += option.amount * option.count;
        row.dayKeys.add(dayKey);
      });
    });

    const observedByType = new Map();
    aggregateOptions(byDate.get(targetKey) || []).forEach(option => {
      if (!observedByType.has(option.type)) observedByType.set(option.type, []);
      observedByType.get(option.type).push(option);
    });

    return [...types.entries()].map(([type, priceMap]) => {
      const candidates = [...priceMap.values()].map(row => ({
        ...row,
        days: row.dayKeys.size,
        dailyRevenue: row.dayKeys.size ? row.revenue / row.dayKeys.size : 0,
        dailyTickets: row.dayKeys.size ? row.tickets / row.dayKeys.size : 0
      })).sort((a, b) =>
        b.dailyRevenue - a.dailyRevenue || b.days - a.days || b.tickets - a.tickets || b.amount - a.amount
      );

      const recommended = candidates[0];
      const observed = (observedByType.get(type) || [])
        .sort((a, b) => b.count - a.count || b.amount - a.amount);
      const primary = observed[0] || null;
      const current = primary
        ? candidates.find(candidate => priceKey(candidate.amount) === priceKey(primary.amount))
        : null;
      const [confidenceLabel, confidenceClass] = confidence(recommended);

      return {
        type,
        candidates,
        recommended,
        observed,
        primary,
        current,
        confidenceLabel,
        confidenceClass
      };
    }).sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.type.localeCompare(b.type));
  }

  function signedMoney(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "$0";
    return `${value > 0 ? "+" : "−"}${cash(Math.abs(value))}`;
  }

  function signedCars(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.05) return "0";
    return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
  }

  function observedHtml(row) {
    if (!row.observed.length) return `<span class="forecast-empty">Not observed yet</span>`;
    return `<div class="observed-price-list">${row.observed.map(item => `<span class="observed-price-chip">${cash(item.amount)} × ${item.count}</span>`).join("")}</div>`;
  }

  function changeHtml(row) {
    if (!row.primary) return `<span class="forecast-empty">No selected-date price</span>`;
    if (priceKey(row.primary.amount) === priceKey(row.recommended.amount)) {
      return `<strong>Keep ${cash(row.primary.amount)}</strong><span class="forecast-subtext">Highest revenue per observed-price day</span>`;
    }
    if (!row.current) {
      return `<strong>${cash(row.primary.amount)} → ${cash(row.recommended.amount)}</strong><span class="forecast-subtext">No historical baseline for ${cash(row.primary.amount)}</span>`;
    }
    const revenueDelta = row.recommended.dailyRevenue - row.current.dailyRevenue;
    const ticketDelta = row.recommended.dailyTickets - row.current.dailyTickets;
    return `<strong>${signedMoney(revenueDelta)} / observed-price day</strong><span class="forecast-subtext">${cash(row.primary.amount)} → ${cash(row.recommended.amount)} · ${signedCars(ticketDelta)} cars/day</span>`;
  }

  function testedHtml(row, comparisonDateCount) {
    return `<div class="price-test-list">${[...row.candidates]
      .sort((a, b) => a.amount - b.amount)
      .map(candidate => {
        const best = priceKey(candidate.amount) === priceKey(row.recommended.amount);
        return `<span class="price-test-chip ${best ? "recommended" : ""}"><strong>${cash(candidate.amount)}</strong> · ${cash(candidate.dailyRevenue)}/day · ${candidate.dailyTickets.toFixed(1)} cars · observed ${candidate.days}/${comparisonDateCount} dates</span>`;
      }).join("")}</div>`;
  }

  function render() {
    const body = $("priceRecommendationBody");
    const notice = $("priceRecommendationNotice");
    if (!body || !notice || !hasData()) return;

    const targetKey = $("forecastDate")?.value;
    const location = $("forecastLocation")?.value || "all";
    const basis = $("forecastTimeBasis")?.value || "transaction";
    const count = Number($("forecastWeekdayCount")?.value || 4);

    if (location === "all") {
      notice.className = "recommendation-notice warning";
      notice.textContent = "Choose one parking lot. Combining lots would mix unrelated price menus and create misleading recommendations.";
      body.innerHTML = `<tr><td colspan="9">Select one parking lot above.</td></tr>`;
      return;
    }

    if (!targetKey) return;

    const byDate = groupByDate(selectedRecords(basis, location), basis);
    const priorKey = previousYearKey(targetKey);
    const context = getComparisonContext(byDate, targetKey, count, priorKey);
    const historyKeys = [
      priorKey && byDate.has(priorKey) ? priorKey : null,
      ...context.keys
    ].filter(Boolean);

    if (!historyKeys.length) {
      notice.className = "recommendation-notice warning";
      notice.textContent = "No prior-year or comparable-weekday dates are available for this lot.";
      body.innerHTML = `<tr><td colspan="9">Not enough history to recommend prices.</td></tr>`;
      return;
    }

    const rows = buildRecommendations(byDate, historyKeys, targetKey);
    if (!rows.length) {
      notice.className = "recommendation-notice warning";
      notice.textContent = "No normal paid ticket options were found. Extensions, event, monthly, and unknown ticket types are excluded.";
      body.innerHTML = `<tr><td colspan="9">No recommendable prices found.</td></tr>`;
      return;
    }

    const weekdayText = context.includedDayNames?.length
      ? ` Included weekdays: ${context.includedDayNames.join(", ")}.`
      : "";

    notice.className = "recommendation-notice";
    notice.textContent = `Recommendations use the same ${historyKeys.length} historical comparison dates shown below.${weekdayText} “Days price observed” counts the dates on which that exact ticket type and price appears. The selected date is shown separately and is not included in the historical average.`;

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${esc(row.type)}</strong></td>
        <td>${observedHtml(row)}</td>
        <td><span class="recommended-price">${cash(row.recommended.amount)}</span></td>
        <td><strong>${cash(row.recommended.dailyRevenue)}</strong><span class="forecast-subtext">${cash(row.recommended.revenue)} total</span></td>
        <td>${row.recommended.dailyTickets.toFixed(1)}<span class="forecast-subtext">${row.recommended.tickets} total</span></td>
        <td><strong>${row.recommended.days} of ${historyKeys.length}</strong><span class="forecast-subtext">historical dates</span></td>
        <td>${changeHtml(row)}</td>
        <td><span class="confidence-badge ${row.confidenceClass}">${row.confidenceLabel}</span></td>
        <td>${testedHtml(row, historyKeys.length)}</td>
      </tr>`).join("");
  }

  createUi();
  render();
})();
