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

  let renderTimer = null;
  let observer = null;

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

  function validBasePurchase(record) {
    if (!Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0) return false;
    const status = String(record.ticketStatus || "").toLowerCase();
    if (status.includes("cancel") || status.includes("void") || status.includes("refund")) return false;
    if (typeof isNonBaseTicketRecord === "function" && isNonBaseTicketRecord(record)) return false;
    if (typeof isExtensionRecord === "function" && isExtensionRecord(record)) return false;
    return true;
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

  function formatTime(minutes) {
    const normalized = ((minutes % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`;
  }

  function formatRange(startMinute, endMinuteExclusive) {
    const endDisplay = Math.max(startMinute, endMinuteExclusive - 1);
    return `${formatTime(startMinute)}–${formatTime(endDisplay)}`;
  }

  function daypart(startMinute) {
    if (startMinute < 360) return "Early morning";
    if (startMinute < 720) return "Morning";
    if (startMinute < 1020) return "Afternoon";
    if (startMinute < 1260) return "Evening";
    return "Late evening";
  }

  function createUi() {
    const forecastPage = $("forecastPage");
    const historyTable = document.querySelector(".forecast-table")?.closest(".table-wrap");
    if (!forecastPage || !historyTable) return false;

    let panel = $("slotPriceRecommendationPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "slotPriceRecommendationPanel";
      panel.className = "slot-pricing-panel";
      panel.innerHTML = `
        <div class="slot-pricing-heading">
          <div>
            <p class="slot-eyebrow">Pricing recommendation</p>
            <h3>Recommended prices by time of day</h3>
            <p>Each ticket option is compared only with the same option during the same time window. This prevents a busy daytime price from being recommended for the whole day.</p>
          </div>
        </div>

        <div class="slot-how-it-works">
          <strong>How the recommendation works</strong>
          <span>Revenue still matters, but a price must also repeat across comparable dates. A one-day high price cannot win only because that day was unusually busy.</span>
        </div>

        <div class="slot-control-grid">
          <div>
            <label class="control-label" for="slotComparisonDays">Pricing comparison days</label>
            <select id="slotComparisonDays">
              <option value="same" selected>Same weekday only — safest</option>
              <option value="all">All comparable-demand weekdays</option>
            </select>
          </div>
          <div>
            <label class="control-label" for="slotBlockMinutes">Time detail</label>
            <select id="slotBlockMinutes">
              <option value="60" selected>1-hour blocks</option>
              <option value="120">2-hour blocks</option>
            </select>
          </div>
          <div>
            <label class="control-label" for="slotMinimumDates">Minimum dates supporting a price</label>
            <select id="slotMinimumDates">
              <option value="2" selected>At least 2 dates</option>
              <option value="3">At least 3 dates</option>
              <option value="4">At least 4 dates</option>
            </select>
          </div>
          <div>
            <label class="control-label" for="slotOptionsShown">Ticket options shown</label>
            <select id="slotOptionsShown">
              <option value="all" selected>All historically supported options</option>
              <option value="current">Only options sold on selected date</option>
            </select>
          </div>
        </div>

        <div id="slotPricingNotice" class="slot-pricing-notice">Choose one parking lot to calculate time-slot recommendations.</div>
        <div id="slotPricingCards" class="slot-pricing-cards"></div>`;
      historyTable.parentNode.insertBefore(panel, historyTable);

      ["slotComparisonDays", "slotBlockMinutes", "slotMinimumDates", "slotOptionsShown"]
        .forEach(id => $(id)?.addEventListener("change", scheduleRender));
    }

    const oldPanel = $("priceRecommendationPanel");
    if (oldPanel) oldPanel.setAttribute("aria-hidden", "true");
    return true;
  }

  function historyKeysFromVisibleTable(targetKey, comparisonMode) {
    const target = parseKey(targetKey);
    if (!target) return [];

    const keys = [...document.querySelectorAll("#forecastTableBody tr")]
      .map(row => row.querySelector("td:first-child .forecast-subtext")?.textContent?.trim())
      .filter(key => key && key !== targetKey && parseKey(key));

    const unique = [...new Set(keys)];
    if (comparisonMode === "all") return unique;
    return unique.filter(key => parseKey(key)?.getDay() === target.getDay());
  }

  function selectedRecords(location, basis) {
    return state.records.filter(record =>
      validBasePurchase(record) &&
      record.location === location &&
      recordTime(record, basis)
    );
  }

  function recordsByDate(records, basis) {
    const map = new Map();
    records.forEach(record => {
      const key = dateKey(recordTime(record, basis));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    });
    return map;
  }

  function recordsInRange(records, basis, startMinute, endMinuteExclusive, type) {
    return (records || []).filter(record => {
      const time = recordTime(record, basis);
      if (!time || ticketType(record) !== type) return false;
      const minute = time.getHours() * 60 + time.getMinutes();
      return minute >= startMinute && minute < endMinuteExclusive;
    });
  }

  function dominantPrice(records) {
    const prices = new Map();
    records.forEach(record => {
      const key = Number(record.amount).toFixed(2);
      if (!prices.has(key)) prices.set(key, { price: Number(record.amount), tickets: 0, revenue: 0 });
      const row = prices.get(key);
      row.tickets += 1;
      row.revenue += Number(record.amount);
    });
    const rows = [...prices.values()].sort((a, b) =>
      b.tickets - a.tickets || b.revenue - a.revenue || a.price - b.price
    );
    return rows[0] || null;
  }

  function candidateStats(byDate, historyKeys, basis, startMinute, endMinuteExclusive, type, minimumDates) {
    const byPrice = new Map();
    let datesWithOption = 0;

    historyKeys.forEach(key => {
      const records = recordsInRange(byDate.get(key), basis, startMinute, endMinuteExclusive, type);
      if (!records.length) return;
      datesWithOption += 1;

      const dominant = dominantPrice(records);
      if (!dominant) return;
      const priceKey = dominant.price.toFixed(2);
      if (!byPrice.has(priceKey)) {
        byPrice.set(priceKey, {
          price: dominant.price,
          days: 0,
          tickets: 0,
          revenue: 0,
          dailyRevenue: [],
          dailyTickets: [],
          dateKeys: []
        });
      }
      const row = byPrice.get(priceKey);
      row.days += 1;
      row.tickets += dominant.tickets;
      row.revenue += dominant.revenue;
      row.dailyRevenue.push(dominant.revenue);
      row.dailyTickets.push(dominant.tickets);
      row.dateKeys.push(key);
    });

    const candidates = [...byPrice.values()].map(row => ({
      ...row,
      supportShare: datesWithOption ? row.days / datesWithOption : 0,
      typicalRevenueWhenUsed: median(row.dailyRevenue) || 0,
      averageRevenueWhenUsed: average(row.dailyRevenue) || 0,
      averageTicketsWhenUsed: average(row.dailyTickets) || 0,
      revenuePerComparableDate: datesWithOption ? row.revenue / datesWithOption : 0,
      eligible: row.days >= minimumDates
    })).sort((a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.revenuePerComparableDate - a.revenuePerComparableDate ||
      b.supportShare - a.supportShare ||
      b.days - a.days ||
      b.tickets - a.tickets ||
      a.price - b.price
    );

    return {
      datesWithOption,
      candidates,
      best: candidates[0] || null
    };
  }

  function currentPrice(byDate, targetKey, basis, startMinute, endMinuteExclusive, type) {
    const records = recordsInRange(byDate.get(targetKey), basis, startMinute, endMinuteExclusive, type);
    const dominant = dominantPrice(records);
    return dominant ? { ...dominant, allTickets: records.length } : null;
  }

  function confidence(best, datesWithOption) {
    if (!best) return ["Not enough data", "low"];
    if (best.days >= 5 && best.tickets >= 20 && best.supportShare >= 0.55 && datesWithOption >= 5) {
      return ["High", "high"];
    }
    if (best.days >= 2 && best.tickets >= 8 && best.supportShare >= 0.30) {
      return ["Medium", "medium"];
    }
    return ["Low", "low"];
  }

  function recommendationForRange(byDate, historyKeys, targetKey, basis, startMinute, endMinuteExclusive, type, minimumDates) {
    const stats = candidateStats(byDate, historyKeys, basis, startMinute, endMinuteExclusive, type, minimumDates);
    if (!stats.best) return null;
    const current = currentPrice(byDate, targetKey, basis, startMinute, endMinuteExclusive, type);
    const [confidenceLabel, confidenceClass] = confidence(stats.best, stats.datesWithOption);
    return {
      type,
      startMinute,
      endMinuteExclusive,
      current,
      ...stats,
      confidenceLabel,
      confidenceClass
    };
  }

  function bucketRecommendations(byDate, historyKeys, targetKey, basis, blockMinutes, minimumDates, optionMode) {
    const currentTypes = new Set((byDate.get(targetKey) || [])
      .map(ticketType)
      .filter(usableType));
    const historicalTypes = new Set();
    historyKeys.forEach(key => {
      (byDate.get(key) || []).forEach(record => {
        const type = ticketType(record);
        if (usableType(type)) historicalTypes.add(type);
      });
    });

    const types = [...historicalTypes]
      .filter(type => optionMode === "all" || currentTypes.has(type))
      .sort((a, b) => typeOrder(a) - typeOrder(b) || a.localeCompare(b));

    const buckets = [];
    types.forEach(type => {
      for (let start = 0; start < 1440; start += blockMinutes) {
        const recommendation = recommendationForRange(
          byDate,
          historyKeys,
          targetKey,
          basis,
          start,
          Math.min(1440, start + blockMinutes),
          type,
          minimumDates
        );
        if (recommendation) buckets.push(recommendation);
      }
    });
    return buckets;
  }

  function mergeBuckets(byDate, historyKeys, targetKey, basis, buckets, minimumDates) {
    const byType = new Map();
    buckets.forEach(bucket => {
      if (!byType.has(bucket.type)) byType.set(bucket.type, []);
      byType.get(bucket.type).push(bucket);
    });

    const merged = [];
    byType.forEach((typeBuckets, type) => {
      typeBuckets.sort((a, b) => a.startMinute - b.startMinute);
      let run = null;

      const finishRun = () => {
        if (!run) return;
        const combined = recommendationForRange(
          byDate,
          historyKeys,
          targetKey,
          basis,
          run.startMinute,
          run.endMinuteExclusive,
          type,
          minimumDates
        );
        if (combined) merged.push(combined);
        run = null;
      };

      typeBuckets.forEach(bucket => {
        const bestPrice = bucket.best?.price ?? null;
        const currentPriceValue = bucket.current?.price ?? null;
        const sameAsRun = run &&
          run.endMinuteExclusive === bucket.startMinute &&
          run.bestPrice === bestPrice &&
          run.currentPrice === currentPriceValue;

        if (sameAsRun) {
          run.endMinuteExclusive = bucket.endMinuteExclusive;
          return;
        }

        finishRun();
        run = {
          startMinute: bucket.startMinute,
          endMinuteExclusive: bucket.endMinuteExclusive,
          bestPrice,
          currentPrice: currentPriceValue
        };
      });
      finishRun();
    });

    return merged.sort((a, b) =>
      a.startMinute - b.startMinute ||
      typeOrder(a.type) - typeOrder(b.type) ||
      a.type.localeCompare(b.type)
    );
  }

  function alternativeText(row) {
    const alternatives = row.candidates.filter(candidate => candidate.price !== row.best.price).slice(0, 2);
    if (!alternatives.length) {
      return `Only ${cash(row.best.price)} had enough repeated evidence in this time window.`;
    }
    const challenger = alternatives[0];
    return `${cash(row.best.price)} contributed ${cash(row.best.revenuePerComparableDate)} per comparable date and appeared on ${row.best.days}/${row.datesWithOption} dates. ${cash(challenger.price)} contributed ${cash(challenger.revenuePerComparableDate)} and appeared on ${challenger.days}/${row.datesWithOption}.`;
  }

  function candidateDetails(row) {
    return row.candidates.map(candidate => `
      <div class="slot-candidate ${candidate.price === row.best.price ? "winner" : ""}">
        <strong>${cash(candidate.price)}</strong>
        <span>${candidate.days}/${row.datesWithOption} dates</span>
        <span>${candidate.tickets} tickets</span>
        <span>${cash(candidate.revenuePerComparableDate)} revenue/comparable date</span>
        <span>${cash(candidate.typicalRevenueWhenUsed)} typical revenue when used</span>
      </div>`).join("");
  }

  function statusBadge(row) {
    if (!row.current) return `<span class="slot-status historical">Historical suggestion</span>`;
    if (Number(row.current.price).toFixed(2) === Number(row.best.price).toFixed(2)) {
      return `<span class="slot-status keep">Keep</span>`;
    }
    return `<span class="slot-status review">Review change</span>`;
  }

  function rowHtml(row) {
    const current = row.current
      ? `<strong>${cash(row.current.price)}</strong><span>${row.current.tickets} sale${row.current.tickets === 1 ? "" : "s"} in this period</span>`
      : `<strong>Not observed</strong><span>No selected-date sale in this period</span>`;

    return `
      <article class="slot-option-row">
        <div class="slot-option-name"><strong>${esc(row.type)}</strong>${statusBadge(row)}</div>
        <div class="slot-price-cell"><span class="slot-cell-label">Selected date</span>${current}</div>
        <div class="slot-price-cell recommended"><span class="slot-cell-label">Recommended</span><strong>${cash(row.best.price)}</strong><span>${row.best.days}/${row.datesWithOption} dates · ${row.best.tickets} tickets</span></div>
        <div class="slot-price-cell"><span class="slot-cell-label">Revenue evidence</span><strong>${cash(row.best.revenuePerComparableDate)}</strong><span>per comparable date</span></div>
        <div class="slot-confidence"><span class="confidence-badge ${row.confidenceClass}">${row.confidenceLabel}</span></div>
        <div class="slot-reason">${esc(alternativeText(row))}</div>
        <details class="slot-details"><summary>See every tested price</summary><div class="slot-candidate-list">${candidateDetails(row)}</div></details>
      </article>`;
  }

  function renderCards(rows) {
    const container = $("slotPricingCards");
    if (!container) return;
    if (!rows.length) {
      container.innerHTML = `<div class="slot-empty">No time-slot recommendations have enough historical evidence for these settings.</div>`;
      return;
    }

    const groups = new Map();
    rows.forEach(row => {
      const key = `${row.startMinute}|${row.endMinuteExclusive}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    container.innerHTML = [...groups.entries()].map(([key, groupRows]) => {
      const [startMinute, endMinuteExclusive] = key.split("|").map(Number);
      groupRows.sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.type.localeCompare(b.type));
      return `
        <section class="slot-card">
          <header class="slot-card-header">
            <div><span class="slot-daypart">${daypart(startMinute)}</span><h4>${formatRange(startMinute, endMinuteExclusive)}</h4></div>
            <span class="slot-option-count">${groupRows.length} option${groupRows.length === 1 ? "" : "s"}</span>
          </header>
          <div class="slot-card-body">${groupRows.map(rowHtml).join("")}</div>
        </section>`;
    }).join("");
  }

  function render() {
    if (!createUi() || !hasData()) return;

    const location = $("forecastLocation")?.value || "all";
    const targetKey = $("forecastDate")?.value;
    const basis = $("forecastTimeBasis")?.value || "transaction";
    const comparisonMode = $("slotComparisonDays")?.value || "same";
    const blockMinutes = Number($("slotBlockMinutes")?.value || 60);
    const minimumDates = Number($("slotMinimumDates")?.value || 2);
    const optionMode = $("slotOptionsShown")?.value || "all";
    const notice = $("slotPricingNotice");

    if (!targetKey || location === "all") {
      notice.className = "slot-pricing-notice warning";
      notice.textContent = "Choose one parking lot above. Price schedules are location-specific, so combining lots would create misleading recommendations.";
      $("slotPricingCards").innerHTML = "";
      return;
    }

    const historyKeys = historyKeysFromVisibleTable(targetKey, comparisonMode);
    if (!historyKeys.length) {
      notice.className = "slot-pricing-notice warning";
      notice.textContent = comparisonMode === "same"
        ? "No same-weekday comparison dates are visible below. Increase the number of historical days or temporarily include comparable-demand weekdays."
        : "No accepted historical comparison dates are visible below.";
      $("slotPricingCards").innerHTML = "";
      return;
    }

    const records = selectedRecords(location, basis);
    const byDate = recordsByDate(records, basis);
    const buckets = bucketRecommendations(
      byDate,
      historyKeys,
      targetKey,
      basis,
      blockMinutes,
      minimumDates,
      optionMode
    );
    const rows = mergeBuckets(byDate, historyKeys, targetKey, basis, buckets, minimumDates);

    const targetDay = parseKey(targetKey)?.toLocaleDateString("en-US", { weekday: "long" }) || "selected weekday";
    notice.className = "slot-pricing-notice";
    notice.textContent = comparisonMode === "same"
      ? `Using ${historyKeys.length} accepted historical ${targetDay} date${historyKeys.length === 1 ? "" : "s"}. Revenue is scored inside matching time windows, and repeated prices receive more weight than one-day spikes.`
      : `Using ${historyKeys.length} accepted comparable-demand dates shown below. Revenue is scored inside matching time windows, and repeated prices receive more weight than one-day spikes.`;

    renderCards(rows);
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 180);
  }

  function initialize() {
    if (!createUi()) {
      setTimeout(initialize, 80);
      return;
    }

    [
      "forecastDate",
      "forecastLocation",
      "forecastTimeBasis",
      "forecastWeekdayCount",
      "forecastComparisonMode",
      "forecastDemandTolerance"
    ].forEach(id => {
      document.addEventListener("change", event => {
        if (event.target?.id === id) scheduleRender();
      });
    });

    document.addEventListener("parking-data-updated", scheduleRender);
    $("forecastPageBtn")?.addEventListener("click", scheduleRender);

    const tableBody = $("forecastTableBody");
    if (tableBody) {
      observer = new MutationObserver(scheduleRender);
      observer.observe(tableBody, { childList: true, subtree: true });
    }

    scheduleRender();
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", initialize)
    : initialize();
})();
