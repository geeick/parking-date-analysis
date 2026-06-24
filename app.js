const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const state = {
  rawRows: [],
  records: [],
  columns: {},
  lastAggregatedRows: [],
  locations: [],
  allLocations: true,
  selectedLocations: new Set()
};

const els = {
  fileInput: document.getElementById("fileInput"),
  dropZone: document.getElementById("dropZone"),
  statusCard: document.getElementById("statusCard"),
  controls: document.getElementById("controls"),
  results: document.getElementById("results"),
  locationSummary: document.getElementById("locationSummary"),
  locationSearch: document.getElementById("locationSearch"),
  locationList: document.getElementById("locationList"),
  selectAllLocations: document.getElementById("selectAllLocations"),
  clearLocations: document.getElementById("clearLocations"),
  dateMode: document.getElementById("dateMode"),
  specificDateWrap: document.getElementById("specificDateWrap"),
  specificDate: document.getElementById("specificDate"),
  startDateWrap: document.getElementById("startDateWrap"),
  startDate: document.getElementById("startDate"),
  endDateWrap: document.getElementById("endDateWrap"),
  endDate: document.getElementById("endDate"),
  compareYears: document.getElementById("compareYears"),
  sameDatesOnly: document.getElementById("sameDatesOnly"),
  weekdayVariation: document.getElementById("weekdayVariation"),
  scatterValues: document.getElementById("scatterValues"),
  priceLabels: document.getElementById("priceLabels"),
  generateBtn: document.getElementById("generateBtn"),
  chartTitle: document.getElementById("chartTitle"),
  chartNote: document.getElementById("chartNote"),
  chart: document.getElementById("chart"),
  metricEntries: document.getElementById("metricEntries"),
  metricDates: document.getElementById("metricDates"),
  metricPeak: document.getElementById("metricPeak"),
  metricPaid: document.getElementById("metricPaid"),
  downloadPngBtn: document.getElementById("downloadPngBtn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  pageTabs: document.getElementById("pageTabs"),
  hourlyPageBtn: document.getElementById("hourlyPageBtn"),
  nowPageBtn: document.getElementById("nowPageBtn"),
  dashboard: document.getElementById("dashboard"),
  nowPage: document.getElementById("nowPage"),
  nowLocationFilter: document.getElementById("nowLocationFilter"),
  nowOpenTickets: document.getElementById("nowOpenTickets"),
  nowActiveLots: document.getElementById("nowActiveLots"),
  nowOldestOpen: document.getElementById("nowOldestOpen"),
  nowTableBody: document.getElementById("nowTableBody"),
  downloadOpenTicketsBtn: document.getElementById("downloadOpenTicketsBtn")
};

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(headers, candidates) {
  const normalized = new Map(headers.map(h => [normalizeHeader(h), h]));
  for (const candidate of candidates) {
    const hit = normalized.get(normalizeHeader(candidate));
    if (hit) return hit;
  }

  for (const header of headers) {
    const compact = normalizeHeader(header);
    if (candidates.some(c => compact.includes(normalizeHeader(c)))) return header;
  }

  return null;
}

function uniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const cleaned = String(header || "").trim() || `Column ${index + 1}`;
    const count = counts.get(cleaned) || 0;
    counts.set(cleaned, count + 1);
    return count === 0 ? cleaned : `${cleaned} ${count + 1}`;
  });
}

function findHeaderRow(table) {
  const maxScan = Math.min(table.length, 30);
  let best = { index: -1, score: -1, headers: [] };

  for (let i = 0; i < maxScan; i++) {
    const row = (table[i] || []).map(cell => String(cell || "").trim());
    const nonEmpty = row.filter(Boolean).length;
    if (nonEmpty < 3) continue;

    const headers = uniqueHeaders(row);
    let score = 0;
    if (findColumn(headers, ["Location", "Parking Lot", "Lot", "Lot Name", "parking_lot", "location_name"])) score += 3;
    if (findColumn(headers, ["Entry Time", "Entry Date", "Entered At", "entry_time", "entry_datetime", "date entered", "Time Entered"])) score += 6;
    if (findColumn(headers, ["Amount", "Total", "Paid", "Price", "Payment Amount", "amount_paid", "transaction_amount"])) score += 2;
    if (findColumn(headers, ["Transaction Time", "Payment Time", "Paid Time", "transaction_time", "payment_time"])) score += 1;

    // Normal report files often have a title row first, then the real header row.
    // This scoring makes the app pick the row with actual column names instead of the report title.
    if (score > best.score) best = { index: i, score, headers };
  }

  return best.score >= 6 ? best : null;
}

function tableToObjects(table, headerInfo) {
  const headers = headerInfo.headers;
  const rows = [];

  for (let i = headerInfo.index + 1; i < table.length; i++) {
    const rowArray = table[i] || [];
    const hasData = rowArray.some(cell => String(cell || "").trim() !== "");
    if (!hasData) continue;

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = rowArray[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function parseDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;

  // Handles values like 06/14/2026 3:00 PM, 6/14/26 15:00, and 07/04/2025 11:30 PM.
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?)?/i);
  if (slash) {
    let [, mm, dd, yyyy, hh = "0", min = "0", ampm] = slash;
    let year = Number(yyyy.length === 2 ? `20${yyyy}` : yyyy);
    let hour = Number(hh);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === "PM" && hour !== 12) hour += 12;
      if (upper === "AM" && hour === 12) hour = 0;
    }
    return new Date(year, Number(mm) - 1, Number(dd), hour, Number(min), 0, 0);
  }

  // Handles values like 2026-06-14 15:00 or 2026-06-14T15:00.
  const isoish = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2})(?::(\d{2}))?)?/);
  if (isoish) {
    const [, yyyy, mm, dd, hh = "0", min = "0"] = isoish;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  }

  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;

  return null;
}

function toDateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMonthDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function showStatus(message, type = "success") {
  els.statusCard.textContent = message;
  els.statusCard.className = `status-card ${type}`;
}

function setDateModeVisibility() {
  const mode = els.dateMode.value;
  els.specificDateWrap.classList.toggle("hidden", mode !== "specific");
  els.startDateWrap.classList.toggle("hidden", mode !== "range");
  els.endDateWrap.classList.toggle("hidden", mode !== "range");
}

function handleFile(file) {
  if (!file) return;

  showStatus(`Reading ${file.name}...`, "success");

  Papa.parse(file, {
    header: false,
    skipEmptyLines: "greedy",
    complete: results => {
      if (results.errors.length) console.warn(results.errors);

      const table = results.data || [];
      const headerInfo = findHeaderRow(table);
      if (!headerInfo) {
        showStatus("I could not find a real header row with an Entry Time column. The CSV can have a report-title row above the headers, but it still needs a column like 'Entry Time'.", "error");
        return;
      }

      const rows = tableToObjects(table, headerInfo);
      loadRows(rows, file.name, headerInfo.index + 1);
    },
    error: error => showStatus(`Could not read the CSV: ${error.message}`, "error")
  });
}

function loadRows(rows, fileName, headerLineNumber) {
  const headers = Object.keys(rows[0] || {});
  if (!headers.length) {
    showStatus("The CSV looks empty or does not have data below the headers.", "error");
    return;
  }

  const locationCol = findColumn(headers, ["Location", "Parking Lot", "Lot", "Lot Name", "parking_lot", "location_name"]);
  const entryTimeCol = findColumn(headers, ["Entry Time", "Entry Date", "Entered At", "entry_time", "entry_datetime", "date entered", "Time Entered"]);
  const amountCol = findColumn(headers, ["Amount", "Total", "Paid", "Price", "Payment Amount", "amount_paid", "transaction_amount"]);
  const paymentTimeCol = findColumn(headers, ["Transaction Time", "Payment Time", "Paid Time", "transaction_time", "payment_time"]);
  const exitTimeCol = findColumn(headers, ["Exit Time", "Exit Date", "Exit Date Time", "Exited At", "exit_time", "exit_datetime"]);
  const ticketStatusCol = findColumn(headers, ["Ticket Status", "Status", "ticket_status"]);
  const ticketCol = findColumn(headers, ["Ticket#", "Ticket", "Ticket Number", "ticket_number"]);
  const licenseCol = findColumn(headers, ["License Plate No.", "License Plate", "Plate", "license_plate", "license"]);
  const transactionDescriptionCol = findColumn(headers, ["Transaction Description", "Description", "transaction_description"]);
  const ticketTypeCol = findColumn(headers, ["Ticket Type", "Type", "ticket_type"]);
  const extendedByCol = findColumn(headers, ["Extended By", "ExtendedBy", "extended_by"]);
  const reasonCol = findColumn(headers, ["Reason", "Notes", "reason"]);

  if (!entryTimeCol) {
    showStatus("I found headers, but not an entry-time column. Rename that column to something like 'Entry Time' and upload again.", "error");
    return;
  }

  state.columns = {
    locationCol,
    entryTimeCol,
    amountCol,
    paymentTimeCol,
    exitTimeCol,
    ticketStatusCol,
    ticketCol,
    licenseCol,
    transactionDescriptionCol,
    ticketTypeCol,
    extendedByCol,
    reasonCol
  };
  state.rawRows = rows;
  state.records = rows.map((row, index) => {
    const entryDate = parseDate(row[entryTimeCol]);
    if (!entryDate) return null;

    const amount = amountCol ? toNumber(row[amountCol]) : null;
    const paymentDate = paymentTimeCol ? parseDate(row[paymentTimeCol]) : null;
    const exitRaw = exitTimeCol ? String(row[exitTimeCol] || "").trim() : "";
    const exitDate = exitRaw ? parseDate(exitRaw) : null;
    const ticketStatus = ticketStatusCol ? String(row[ticketStatusCol] || "").trim() : "";
    const ticket = ticketCol ? String(row[ticketCol] || "").trim() : "";
    const licensePlate = licenseCol ? String(row[licenseCol] || "").trim() : "";
    const transactionDescription = transactionDescriptionCol ? String(row[transactionDescriptionCol] || "").trim() : "";
    const ticketType = ticketTypeCol ? String(row[ticketTypeCol] || "").trim() : "";
    const extendedBy = extendedByCol ? String(row[extendedByCol] || "").trim() : "";
    const reason = reasonCol ? String(row[reasonCol] || "").trim() : "";
    const location = locationCol ? String(row[locationCol] || "Unknown Location").trim() : "All imported data";

    return {
      rowIndex: index,
      ticket,
      licensePlate,
      ticketStatus,
      transactionDescription,
      ticketType,
      extendedBy,
      reason,
      location: location || "Unknown Location",
      entryDateObj: entryDate,
      entryDate: toDateKey(entryDate),
      entryHour: entryDate.getHours(),
      year: entryDate.getFullYear(),
      month: entryDate.getMonth() + 1,
      monthName: MONTH_NAMES[entryDate.getMonth()],
      monthDay: toMonthDay(entryDate),
      weekday: WEEKDAYS[entryDate.getDay()],
      weekdayIndex: entryDate.getDay(),
      amount,
      paymentDateObj: paymentDate,
      paymentHour: paymentDate ? paymentDate.getHours() : null,
      exitRaw,
      exitDateObj: exitDate
    };
  }).filter(Boolean);

  if (!state.records.length) {
    showStatus("No valid entry times were found in the CSV.", "error");
    return;
  }

  populateFilters();
  els.controls.classList.remove("hidden");
  els.results.classList.remove("hidden");

  const detected = [`entry: ${entryTimeCol}`];
  if (locationCol) detected.push(`location: ${locationCol}`);
  if (amountCol) detected.push(`amount: ${amountCol}`);
  if (ticketCol) detected.push(`ticket: ${ticketCol}`);
  if (exitTimeCol) detected.push(`exit: ${exitTimeCol}`);
  if (ticketStatusCol) detected.push(`status: ${ticketStatusCol}`);
  showStatus(`Loaded ${state.records.length.toLocaleString()} entries from ${fileName}. Header row detected on line ${headerLineNumber}. Detected ${detected.join(", ")}.`, "success");
  generateChart();
  els.pageTabs?.classList.remove("hidden");
  populateNowLocationFilter();
  renderNowPage();
}

function populateFilters() {
  state.locations = [...new Set(state.records.map(r => r.location))].sort((a, b) => a.localeCompare(b));
  state.allLocations = true;
  state.selectedLocations = new Set();
  els.locationSearch.value = "";
  renderLocationButtons();

  const dates = state.records.map(r => r.entryDate).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  for (const input of [els.specificDate, els.startDate, els.endDate]) {
    input.min = minDate;
    input.max = maxDate;
  }
  els.specificDate.value = maxDate;
  els.startDate.value = minDate;
  els.endDate.value = maxDate;
  els.hourlyPageBtn?.addEventListener("click", () => showDashboardPage("hourly"));
els.nowPageBtn?.addEventListener("click", () => showDashboardPage("now"));
els.nowLocationFilter?.addEventListener("change", renderNowPage);
els.downloadOpenTicketsBtn?.addEventListener("click", downloadOpenTicketsCsv);

setDateModeVisibility();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLocationButtons() {
  const query = els.locationSearch.value.trim().toLowerCase();
  const visibleLocations = state.locations.filter(location => location.toLowerCase().includes(query));

  els.selectAllLocations.classList.toggle("active", state.allLocations);
  els.clearLocations.disabled = state.allLocations && state.selectedLocations.size === 0;

  if (state.allLocations) {
    els.locationSummary.textContent = `All parking lots included (${state.locations.length.toLocaleString()} lot${state.locations.length === 1 ? "" : "s"}).`;
  } else if (state.selectedLocations.size === 0) {
    els.locationSummary.textContent = "No parking lots selected.";
  } else if (state.selectedLocations.size === 1) {
    els.locationSummary.textContent = [...state.selectedLocations][0];
  } else {
    const preview = [...state.selectedLocations].slice(0, 3).join(", ");
    const extra = state.selectedLocations.size > 3 ? ` +${state.selectedLocations.size - 3} more` : "";
    els.locationSummary.textContent = `${state.selectedLocations.size} parking lots selected: ${preview}${extra}`;
  }

  els.locationList.innerHTML = visibleLocations.map(location => {
    const index = state.locations.indexOf(location);
    const selected = !state.allLocations && state.selectedLocations.has(location);
    return `<button type="button" class="location-chip ${selected ? "selected" : ""}" data-location-index="${index}">${escapeHtml(location)}</button>`;
  }).join("");
}

function selectAllLocations() {
  state.allLocations = true;
  state.selectedLocations.clear();
  renderLocationButtons();
  generateChartIfReady();
}

function clearLocations() {
  state.allLocations = false;
  state.selectedLocations.clear();
  renderLocationButtons();
  generateChartIfReady();
}

function toggleLocation(location) {
  if (state.allLocations) {
    state.allLocations = false;
    state.selectedLocations.clear();
    state.selectedLocations.add(location);
  } else if (state.selectedLocations.has(location)) {
    state.selectedLocations.delete(location);
  } else {
    state.selectedLocations.add(location);
  }

  renderLocationButtons();
  generateChartIfReady();
}

function getFilteredRecords() {
  let records = [...state.records];

  if (!state.allLocations) {
    records = records.filter(r => state.selectedLocations.has(r.location));
  }

  const mode = els.dateMode.value;
  if (mode === "specific" && els.specificDate.value) {
    records = records.filter(r => r.entryDate === els.specificDate.value);
  } else if (mode === "range") {
    const start = els.startDate.value || "0000-01-01";
    const end = els.endDate.value || "9999-12-31";
    records = records.filter(r => r.entryDate >= start && r.entryDate <= end);
  }

  if (els.compareYears.checked && els.sameDatesOnly.checked) {
    records = filterToSameMonthDaysAcrossYears(records);
  }

  return records;
}

function filterToSameMonthDaysAcrossYears(records) {
  const years = [...new Set(records.map(r => r.year))];
  if (years.length < 2) return records;

  const monthDaysByYear = new Map();
  for (const year of years) {
    monthDaysByYear.set(year, new Set(records.filter(r => r.year === year).map(r => r.monthDay)));
  }

  let common = null;
  for (const set of monthDaysByYear.values()) {
    common = common === null ? new Set(set) : new Set([...common].filter(md => set.has(md)));
  }

  return records.filter(r => common.has(r.monthDay));
}

function groupKeyForRecord(record) {
  if (els.weekdayVariation.checked) return record.weekday;
  if (els.compareYears.checked) return String(record.year);
  return "Average";
}

function groupSort(groups) {
  if (els.weekdayVariation.checked) {
    const order = new Map(WEEKDAYS.map((day, i) => [day, i]));
    return groups.sort((a, b) => order.get(a) - order.get(b));
  }
  if (els.compareYears.checked) return groups.sort((a, b) => Number(a) - Number(b));
  return groups;
}

function aggregate(records) {
  const dateHourCounts = new Map();
  const datesByGroup = new Map();
  const pricesByGroupHour = new Map();

  for (const record of records) {
    const group = groupKeyForRecord(record);
    const dateHourKey = `${group}|${record.entryDate}|${record.entryHour}`;
    dateHourCounts.set(dateHourKey, (dateHourCounts.get(dateHourKey) || 0) + 1);

    if (!datesByGroup.has(group)) datesByGroup.set(group, new Set());
    datesByGroup.get(group).add(record.entryDate);

    if (record.amount !== null) {
      const priceKey = `${group}|${record.entryHour}`;
      if (!pricesByGroupHour.has(priceKey)) pricesByGroupHour.set(priceKey, []);
      pricesByGroupHour.get(priceKey).push(record.amount);
    }
  }

  const groups = groupSort([...datesByGroup.keys()]);
  const lineRows = [];
  const scatterRows = [];

  for (const group of groups) {
    const dates = [...datesByGroup.get(group)].sort();
    for (const hour of HOURS) {
      let total = 0;
      for (const date of dates) {
        const count = dateHourCounts.get(`${group}|${date}|${hour}`) || 0;
        total += count;
        if (count > 0) scatterRows.push({ group, date, hour, count });
      }

      const prices = pricesByGroupHour.get(`${group}|${hour}`) || [];
      const avgPaid = prices.length ? average(prices) : null;
      lineRows.push({
        group,
        hour,
        avgCars: dates.length ? total / dates.length : 0,
        activeDates: dates.length,
        avgPaid
      });
    }
  }

  return { groups, lineRows, scatterRows };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMoney(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `$${Math.round(value).toLocaleString()}`;
}

function generateChartIfReady() {
  if (state.records.length) generateChart();
}

function generateChart() {
  const records = getFilteredRecords();
  if (!records.length) {
    showStatus("No rows match the selected filters. Choose at least one parking lot or change the date filter.", "error");
    Plotly.purge(els.chart);
    state.lastAggregatedRows = [];
    return;
  }


  const { groups, lineRows, scatterRows } = aggregate(records);
  state.lastAggregatedRows = lineRows;

  updateMetrics(records, lineRows);
  updateTitle(records, groups);

  const traces = [];
  if (els.scatterValues.checked) {
    for (const group of groups) {
      const rows = scatterRows.filter(row => row.group === group);
      traces.push({
        x: rows.map(row => row.hour),
        y: rows.map(row => row.count),
        text: rows.map(row => `${row.date}<br>${group}`),
        mode: "markers",
        type: "scatter",
        name: groups.length === 1 ? "Actual date-hour counts" : `${group} actual counts`,
        marker: { size: 8, opacity: 0.27 },
        hovertemplate: "%{text}<br>Hour %{x}<br>Cars entered: %{y}<extra></extra>"
      });
    }
  }

  const canShowTextLabels = els.priceLabels.checked && groups.length <= 2;
  const tooManyPriceLabels = els.priceLabels.checked && groups.length > 2;

  for (const group of groups) {
    const rows = lineRows.filter(row => row.group === group);
    const priceText = rows.map(row => row.avgPaid === null ? "" : formatMoney(row.avgPaid));
    traces.push({
      x: rows.map(row => row.hour),
      y: rows.map(row => Number(row.avgCars.toFixed(3))),
      customdata: rows.map(row => [row.activeDates, row.avgPaid === null ? "--" : formatMoney(row.avgPaid)]),
      mode: canShowTextLabels ? "lines+markers+text" : "lines+markers",
      type: "scatter",
      name: group,
      text: canShowTextLabels ? priceText : undefined,
      textposition: "top center",
      line: { width: 3 },
      marker: { size: 9 },
      hovertemplate: "Hour %{x}<br>Average cars: %{y}<br>Active dates: %{customdata[0]}<br>Avg. paid: %{customdata[1]}<extra>%{fullData.name}</extra>"
    });
  }

  const yMax = Math.max(5, ...lineRows.map(row => row.avgCars), ...scatterRows.map(row => row.count)) * 1.16;

  const layout = {
    margin: { l: 64, r: 28, t: 24, b: 62 },
    height: 590,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    hovermode: "closest",
    legend: { orientation: "h", y: -0.22, x: 0 },
    xaxis: {
      title: "Hour of Day",
      tickmode: "array",
      tickvals: HOURS,
      range: [-0.5, 23.5],
      gridcolor: "#e5e7eb",
      zeroline: false
    },
    yaxis: {
      title: "Average Cars Entering",
      rangemode: "tozero",
      range: [0, yMax],
      gridcolor: "#e5e7eb",
      zeroline: false
    }
  };

  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"]
  };

  Plotly.newPlot(els.chart, traces, layout, config);

  els.chartNote.textContent = tooManyPriceLabels
    ? "Price labels are in hover because this chart has many lines. This keeps it readable."
    : buildNote(records);
}

function updateMetrics(records, lineRows) {
  const dates = new Set(records.map(r => r.entryDate));
  const amounts = records.map(r => r.amount).filter(v => v !== null);
  const peak = [...lineRows].sort((a, b) => b.avgCars - a.avgCars)[0];

  els.metricEntries.textContent = records.length.toLocaleString();
  els.metricDates.textContent = dates.size.toLocaleString();
  els.metricPeak.textContent = peak ? `${peak.hour}:00` : "--";
  els.metricPaid.textContent = amounts.length ? formatMoney(average(amounts)) : "--";
}

function getLocationLabel() {
  if (state.allLocations) return "All locations";
  if (state.selectedLocations.size === 0) return "No locations";
  if (state.selectedLocations.size === 1) return [...state.selectedLocations][0];
  return `${state.selectedLocations.size} selected locations`;
}

function updateTitle(records, groups) {
  let split = "Average hourly entries";
  if (els.weekdayVariation.checked) split = "Hourly entries by day of week";
  else if (els.compareYears.checked) split = "Hourly entries by year";

  const dates = [...new Set(records.map(r => r.entryDate))].sort();
  const dateText = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  els.chartTitle.textContent = `${split} · ${getLocationLabel()}`;
  els.chartTitle.title = `${dateText} · ${groups.length} group${groups.length === 1 ? "" : "s"}`;
}

function buildNote(records) {
  const dates = [...new Set(records.map(r => r.entryDate))].sort();
  const dateText = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
  const locText = getLocationLabel();
  return `Each point is the average for that hour across ${dates.length.toLocaleString()} active date${dates.length === 1 ? "" : "s"}. Location filter: ${locText}. Date span: ${dateText}.`;
}


function getAnalysisNow(records) {
  const times = records
    .map(r => r.transactionDateObj || r.paymentDateObj || r.entryDateObj)
    .filter(Boolean)
    .map(d => d.getTime());

  if (!times.length) return new Date();
  return new Date(Math.max(...times));
}

function startOfPreviousDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 0, 0, 0, 0);
}

function isExtensionRecord(record) {
  const text = [
    record.extendedBy,
    record.transactionDescription,
    record.ticketType,
    record.reason
  ].join(" ").toLowerCase();

  // Important: extension rows are payment/time-extension records, not extra cars.
  // Do not count them as separate open tickets.
  return Boolean(String(record.extendedBy || "").trim()) ||
    /\bextension\b|\bextended\b|\bextend\b|\brenewal\b|\brenewed\b/.test(text);
}

function isClosedStatus(statusText) {
  const status = String(statusText || "").toLowerCase();
  return status.includes("closed") ||
    status.includes("close") ||
    status.includes("completed") ||
    status.includes("complete") ||
    status.includes("cancel") ||
    status.includes("void") ||
    status.includes("refund");
}

function isOpenTicket(record) {
  if (isExtensionRecord(record)) return false;

  const status = String(record.ticketStatus || "").toLowerCase();
  const hasExitTime = Boolean(record.exitDateObj) || Boolean(record.exitRaw);

  if (hasExitTime) return false;
  if (isClosedStatus(status)) return false;
  if (status.includes("open")) return true;

  // If there is no exit time and the ticket is not explicitly closed, treat it as currently open.
  return true;
}

function latestPrimaryRecordPerTicket(records) {
  const latest = new Map();

  for (const record of records) {
    // Extension rows should not become their own open ticket and should not replace the original row.
    if (isExtensionRecord(record)) continue;

    const key = record.ticket || record.licensePlate || `${record.location}|row-${record.rowIndex}`;
    const recordTime = (record.transactionDateObj || record.paymentDateObj || record.entryDateObj || new Date(0)).getTime();

    if (!latest.has(key)) {
      latest.set(key, record);
      continue;
    }

    const old = latest.get(key);
    const oldTime = (old.transactionDateObj || old.paymentDateObj || old.entryDateObj || new Date(0)).getTime();

    if (recordTime > oldTime) latest.set(key, record);
  }

  return [...latest.values()];
}

function getOpenTicketsNow() {
  const analysisNow = getAnalysisNow(state.records);
  const since = startOfPreviousDay(analysisNow);
  const latestRecords = latestPrimaryRecordPerTicket(state.records);

  return latestRecords.filter(record => {
    if (!record.entryDateObj) return false;
    if (record.entryDateObj < since) return false;
    if (record.entryDateObj > analysisNow) return false;
    return isOpenTicket(record);
  });
}

function populateNowLocationFilter() {
  if (!els.nowLocationFilter) return;

  const current = els.nowLocationFilter.value || "all";
  const locations = [...new Set(state.records.map(r => r.location))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  els.nowLocationFilter.innerHTML = `<option value="all">All locations</option>` +
    locations.map(location => `<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join("");

  if (locations.includes(current)) els.nowLocationFilter.value = current;
}

function renderNowPage() {
  if (!els.nowPage || !state.records.length) return;

  const filter = els.nowLocationFilter?.value || "all";
  const analysisNow = getAnalysisNow(state.records);
  let openTickets = getOpenTicketsNow();

  if (filter !== "all") openTickets = openTickets.filter(r => r.location === filter);

  const byLocation = new Map();
  for (const ticket of openTickets) {
    if (!byLocation.has(ticket.location)) byLocation.set(ticket.location, []);
    byLocation.get(ticket.location).push(ticket);
  }

  const rows = [...byLocation.entries()].map(([location, tickets]) => {
    const oldest = tickets.reduce((min, ticket) => !min || ticket.entryDateObj < min ? ticket.entryDateObj : min, null);
    const avgHours = tickets.reduce((sum, ticket) => sum + ((analysisNow - ticket.entryDateObj) / 36e5), 0) / tickets.length;
    return { location, count: tickets.length, oldest, avgHours };
  }).sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));

  if (els.nowOpenTickets) els.nowOpenTickets.textContent = openTickets.length.toLocaleString();
  if (els.nowActiveLots) els.nowActiveLots.textContent = rows.length.toLocaleString();

  const oldestOverall = rows.map(r => r.oldest).filter(Boolean).sort((a, b) => a - b)[0];
  if (els.nowOldestOpen) els.nowOldestOpen.textContent = oldestOverall ? oldestOverall.toLocaleString() : "--";

  if (!els.nowTableBody) return;
  if (!rows.length) {
    els.nowTableBody.innerHTML = `<tr><td colspan="4">No open tickets found for the selected CSV/location.</td></tr>`;
    return;
  }

  els.nowTableBody.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.location)}</td>
      <td><strong>${row.count.toLocaleString()}</strong></td>
      <td>${row.oldest ? row.oldest.toLocaleString() : "--"}</td>
      <td>${Number(row.avgHours).toFixed(1)}</td>
    </tr>
  `).join("");
}

function downloadOpenTicketsCsv() {
  const openTickets = getOpenTicketsNow();
  const csvRows = openTickets.map(ticket => ({
    ticket: ticket.ticket,
    license_plate: ticket.licensePlate,
    location: ticket.location,
    entry_time: ticket.entryDateObj ? ticket.entryDateObj.toLocaleString() : "",
    ticket_status: ticket.ticketStatus,
    exit_time: ticket.exitRaw || "",
    amount: ticket.amount ?? "",
    excluded_extension: "no"
  }));

  const csv = Papa.unparse(csvRows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "open_tickets_right_now.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showDashboardPage(pageName) {
  if (pageName === "now") {
    els.dashboard?.classList.add("hidden");
    els.results?.classList.add("hidden");
    els.controls?.classList.add("hidden");
    els.nowPage?.classList.remove("hidden");
    els.hourlyPageBtn?.classList.remove("active");
    els.nowPageBtn?.classList.add("active");
    renderNowPage();
  } else {
    els.dashboard?.classList.remove("hidden");
    els.results?.classList.remove("hidden");
    els.controls?.classList.remove("hidden");
    els.nowPage?.classList.add("hidden");
    els.hourlyPageBtn?.classList.add("active");
    els.nowPageBtn?.classList.remove("active");
  }
}

function downloadAggregatedCsv() {
  if (!state.lastAggregatedRows.length) return;
  const rows = state.lastAggregatedRows.map(row => ({
    location_filter: getLocationLabel(),
    group: row.group,
    hour: row.hour,
    average_cars_entering: row.avgCars.toFixed(3),
    active_dates: row.activeDates,
    average_paid: row.avgPaid === null ? "" : row.avgPaid.toFixed(2)
  }));
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hourly_entry_summary.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.fileInput?.addEventListener("change", event => handleFile(event.target.files[0]));

els.dropZone?.addEventListener("dragover", event => {
  event.preventDefault();
  els.dropZone.classList.add("dragging");
});

els.dropZone?.addEventListener("dragleave", () => els.dropZone.classList.remove("dragging"));

els.dropZone?.addEventListener("drop", event => {
  event.preventDefault();
  els.dropZone.classList.remove("dragging");
  handleFile(event.dataTransfer.files[0]);
});

els.locationSearch?.addEventListener("input", renderLocationButtons);
els.selectAllLocations?.addEventListener("click", selectAllLocations);
els.clearLocations?.addEventListener("click", clearLocations);
els.locationList?.addEventListener("click", event => {
  const button = event.target.closest("button[data-location-index]");
  if (!button) return;
  const location = state.locations[Number(button.dataset.locationIndex)];
  if (location) toggleLocation(location);
});

els.dateMode?.addEventListener("change", () => {
  setDateModeVisibility();
  generateChartIfReady();
});

for (const el of [
  els.specificDate,
  els.startDate,
  els.endDate,
  els.compareYears,
  els.sameDatesOnly,
  els.weekdayVariation,
  els.scatterValues,
  els.priceLabels
]) {
  el?.addEventListener("change", generateChartIfReady);
}

els.generateBtn?.addEventListener("click", generateChart);
els.downloadCsvBtn?.addEventListener("click", downloadAggregatedCsv);
els.downloadPngBtn?.addEventListener("click", () => {
  Plotly.downloadImage(els.chart, {
    format: "png",
    filename: "hourly_entry_graph",
    width: 1600,
    height: 900,
    scale: 2
  });
});

setDateModeVisibility();
