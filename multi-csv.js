(() => {
  const DB_NAME = "parking-date-analysis";
  const DB_VERSION = 1;
  const STORE_NAME = "datasets";
  const DATASET_KEY = "combined";
  const $ = id => document.getElementById(id);
  let loadedFiles = [];
  let busy = false;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("This browser does not support saved local data."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open saved data."));
    });
  }

  async function readSavedDataset() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(DATASET_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("Could not read saved data."));
      transaction.oncomplete = () => db.close();
    });
  }

  async function saveDataset(records, files) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({
        records,
        files,
        savedAt: new Date()
      }, DATASET_KEY);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not save the combined data."));
      };
    });
  }

  async function clearSavedDataset() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(DATASET_KEY);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error("Could not clear saved data."));
      };
    });
  }

  function dateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function reviveRecord(record, index) {
    const entryDateObj = dateValue(record.entryDateObj);
    if (!entryDateObj) return null;
    const paymentDateObj = dateValue(record.paymentDateObj);
    const exitDateObj = dateValue(record.exitDateObj);
    return {
      ...record,
      rowIndex: index,
      entryDateObj,
      paymentDateObj,
      exitDateObj,
      entryDate: toDateKey(entryDateObj),
      entryHour: entryDateObj.getHours(),
      year: entryDateObj.getFullYear(),
      month: entryDateObj.getMonth() + 1,
      monthName: MONTH_NAMES[entryDateObj.getMonth()],
      monthDay: toMonthDay(entryDateObj),
      weekday: WEEKDAYS[entryDateObj.getDay()],
      weekdayIndex: entryDateObj.getDay(),
      paymentHour: paymentDateObj ? paymentDateObj.getHours() : null
    };
  }

  function rowToRecord(row, columns, index, sourceFile) {
    const entryDate = parseDate(row[columns.entryTimeCol]);
    if (!entryDate) return null;
    const paymentDate = columns.paymentTimeCol ? parseDate(row[columns.paymentTimeCol]) : null;
    const exitRaw = columns.exitTimeCol ? cleanCell(row[columns.exitTimeCol]) : "";
    const exitDate = exitRaw ? parseDate(exitRaw) : null;
    const location = columns.locationCol ? cleanCell(row[columns.locationCol]) : "All imported data";

    return {
      rowIndex: index,
      sourceFile,
      location: location || "Unknown Location",
      entryDateObj: entryDate,
      exitRaw,
      exitDateObj: exitDate,
      entryDate: toDateKey(entryDate),
      entryHour: entryDate.getHours(),
      year: entryDate.getFullYear(),
      month: entryDate.getMonth() + 1,
      monthName: MONTH_NAMES[entryDate.getMonth()],
      monthDay: toMonthDay(entryDate),
      weekday: WEEKDAYS[entryDate.getDay()],
      weekdayIndex: entryDate.getDay(),
      amount: columns.amountCol ? toNumber(row[columns.amountCol]) : null,
      paymentDateObj: paymentDate,
      paymentHour: paymentDate ? paymentDate.getHours() : null,
      ticketStatus: columns.ticketStatusCol ? cleanCell(row[columns.ticketStatusCol]) : "",
      ticket: columns.ticketCol ? cleanCell(row[columns.ticketCol]) : "",
      licensePlate: columns.licensePlateCol ? cleanCell(row[columns.licensePlateCol]) : "",
      transactionDescription: columns.transactionDescriptionCol ? cleanCell(row[columns.transactionDescriptionCol]) : "",
      ticketType: columns.ticketTypeCol ? cleanCell(row[columns.ticketTypeCol]) : "",
      durationRaw: columns.durationCol ? cleanCell(row[columns.durationCol]) : "",
      extendedBy: columns.extendedByCol ? cleanCell(row[columns.extendedByCol]) : "",
      reason: columns.reasonCol ? cleanCell(row[columns.reasonCol]) : ""
    };
  }

  async function parseFile(file) {
    const text = await file.text();
    const parsed = Papa.parse(text, {
      header: false,
      skipEmptyLines: "greedy",
      dynamicTyping: false,
      transform: value => cleanCell(value)
    });
    const table = parsed.data || [];
    const headerInfo = findHeaderRow(table);
    if (!headerInfo) throw new Error(`${file.name}: could not detect the Entry Time header.`);
    const rows = tableToObjects(table, headerInfo);
    const columns = detectColumns(headerInfo.headers);
    if (!columns.entryTimeCol) throw new Error(`${file.name}: no Entry Time column was found.`);
    const records = rows
      .map((row, index) => rowToRecord(row, columns, index, file.name))
      .filter(Boolean);
    if (!records.length) throw new Error(`${file.name}: no valid Entry Time values were found.`);
    return {
      records,
      metadata: {
        id: `${file.name}|${file.size}|${file.lastModified}`,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        importedAt: Date.now(),
        parsedRecords: records.length
      },
      warningCount: (parsed.errors || []).length,
      headerLine: headerInfo.index + 1
    };
  }

  function recordIdentity(record) {
    const location = cleanCell(record.location).toLowerCase();
    const ticket = cleanCell(record.ticket).toLowerCase();
    const plate = cleanCell(record.licensePlate).toLowerCase();
    const entry = dateValue(record.entryDateObj)?.getTime() ?? "";
    const payment = dateValue(record.paymentDateObj)?.getTime() ?? "";
    const amount = record.amount === null || !Number.isFinite(Number(record.amount))
      ? ""
      : Number(record.amount).toFixed(2);
    const description = cleanCell(record.transactionDescription).toLowerCase();
    const type = cleanCell(record.ticketType).toLowerCase();
    const duration = cleanCell(record.durationRaw).toLowerCase();
    const extendedBy = cleanCell(record.extendedBy).toLowerCase();

    if (ticket) {
      return ["ticket", location, ticket, payment || entry, amount, description, type, duration, extendedBy].join("|");
    }
    return ["fallback", location, plate, entry, payment, amount, description, type, duration, extendedBy].join("|");
  }

  function mergeRecords(existingRecords, parsedFiles) {
    const merged = new Map();
    let duplicateCount = 0;

    existingRecords.forEach(record => merged.set(recordIdentity(record), record));
    parsedFiles
      .sort((a, b) => a.metadata.lastModified - b.metadata.lastModified)
      .forEach(result => {
        result.records.forEach(record => {
          const key = recordIdentity(record);
          if (merged.has(key)) duplicateCount += 1;
          merged.set(key, record);
        });
      });

    const records = [...merged.values()]
      .map((record, index) => reviveRecord(record, index))
      .filter(Boolean)
      .sort((a, b) => a.entryDateObj - b.entryDateObj)
      .map((record, index) => ({ ...record, rowIndex: index }));

    return { records, duplicateCount };
  }

  function mergeFileMetadata(existingFiles, newFiles) {
    const map = new Map((existingFiles || []).map(file => [file.id, file]));
    newFiles.forEach(file => map.set(file.id, file));
    return [...map.values()].sort((a, b) => a.importedAt - b.importedAt);
  }

  function createLibraryUi() {
    if ($("csvLibrary")) return;
    const status = $("statusCard");
    const panel = document.createElement("section");
    panel.id = "csvLibrary";
    panel.className = "csv-library card";
    panel.innerHTML = `
      <div class="csv-library-heading">
        <div>
          <strong>Saved CSV library</strong>
          <span>Files are merged, overlapping rows are removed, and the combined data stays in this browser.</span>
        </div>
        <button id="clearCsvLibrary" class="secondary-btn" type="button">Clear saved data</button>
      </div>
      <div id="csvLibrarySummary" class="csv-library-summary">No saved files yet.</div>
      <div id="csvFileList" class="csv-file-list"></div>`;
    status.insertAdjacentElement("afterend", panel);
    $("clearCsvLibrary").addEventListener("click", async () => {
      if (!confirm("Clear all saved CSV data from this browser?")) return;
      await clearSavedDataset();
      location.reload();
    });
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderLibrary() {
    createLibraryUi();
    const summary = $("csvLibrarySummary");
    const list = $("csvFileList");
    if (!loadedFiles.length) {
      summary.textContent = "No saved files yet. Select or drag several CSV files at once.";
      list.innerHTML = "";
      $("clearCsvLibrary").disabled = true;
      return;
    }
    $("clearCsvLibrary").disabled = false;
    summary.textContent = `${loadedFiles.length.toLocaleString()} file${loadedFiles.length === 1 ? "" : "s"} · ${state.records.length.toLocaleString()} unique records stored locally`;
    list.innerHTML = loadedFiles.map(file => `
      <span class="csv-file-chip" title="Imported ${new Date(file.importedAt).toLocaleString()}">
        <strong>${escapeHtml(file.name)}</strong>
        <span>${Number(file.parsedRecords || 0).toLocaleString()} rows${file.size ? ` · ${formatBytes(file.size)}` : ""}</span>
      </span>`).join("");
  }

  function refreshDashboard(records, message, type = "success") {
    const hadData = state.records.length > 0;
    state.fileName = loadedFiles.length === 1 ? loadedFiles[0].name : `${loadedFiles.length} merged CSV files`;
    state.rawRows = [];
    state.columns = {};
    state.records = records;

    if (!records.length) {
      showStatus("No valid records are loaded.", "error");
      renderLibrary();
      return;
    }

    populateFilters();
    els.pageTabs.classList.remove("hidden");
    els.dashboard.classList.remove("hidden");
    els.controls.classList.remove("hidden");
    els.results.classList.remove("hidden");
    populateNowLocationFilter();
    populateTicketTypeFilters();
    if (!hadData) showDashboardPage("hourly");
    generateChart();
    renderNowPage();
    renderTicketTypePage();
    renderLibrary();
    showStatus(message, type);
    document.dispatchEvent(new CustomEvent("parking-data-updated", {
      detail: { records: records.length, files: loadedFiles.length }
    }));
  }

  async function importFiles(fileList) {
    const files = [...(fileList || [])].filter(file => file && /\.csv$/i.test(file.name));
    if (!files.length || busy) return;
    busy = true;
    try {
      showStatus(`Reading ${files.length.toLocaleString()} CSV file${files.length === 1 ? "" : "s"}...`, "success");
      const results = [];
      const errors = [];
      for (let index = 0; index < files.length; index++) {
        showStatus(`Reading ${files[index].name} (${index + 1} of ${files.length})...`, "success");
        try {
          results.push(await parseFile(files[index]));
        } catch (error) {
          console.error(error);
          errors.push(error.message);
        }
      }

      if (!results.length) {
        showStatus(errors.join(" ") || "None of the selected CSV files could be loaded.", "error");
        return;
      }

      const { records, duplicateCount } = mergeRecords(state.records, results);
      loadedFiles = mergeFileMetadata(loadedFiles, results.map(result => result.metadata));
      let saveWarning = "";
      try {
        await saveDataset(records, loadedFiles);
      } catch (error) {
        console.error(error);
        saveWarning = " The combined data is available now but could not be saved for the next visit.";
      }

      const addedRows = results.reduce((sum, result) => sum + result.records.length, 0);
      const message = `Merged ${results.length.toLocaleString()} CSV file${results.length === 1 ? "" : "s"}: ${addedRows.toLocaleString()} parsed rows, ${duplicateCount.toLocaleString()} overlapping rows removed, ${records.length.toLocaleString()} unique records total.${errors.length ? ` ${errors.length} file${errors.length === 1 ? "" : "s"} failed.` : ""}${saveWarning}`;
      refreshDashboard(records, message, errors.length || saveWarning ? "warning" : "success");
      updateDiagnostics(`Combined CSV library\nFiles stored: ${loadedFiles.length}\nUnique records: ${records.length}\nOverlapping rows removed during this import: ${duplicateCount}\n\nImported files:\n${results.map(result => `${result.metadata.name}: ${result.records.length} records, header line ${result.headerLine}, parser warnings ${result.warningCount}`).join("\n")}\n\nErrors:\n${errors.join("\n") || "None"}`);
    } finally {
      busy = false;
      if ($("fileInput")) $("fileInput").value = "";
    }
  }

  function interceptUploads() {
    const input = $("fileInput");
    const dropZone = $("dropZone");
    input?.addEventListener("change", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      importFiles(event.target.files);
    }, true);
    dropZone?.addEventListener("drop", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      dropZone.classList.remove("dragging");
      importFiles(event.dataTransfer.files);
    }, true);
  }

  async function restoreSavedData() {
    createLibraryUi();
    renderLibrary();
    try {
      const saved = await readSavedDataset();
      if (!saved?.records?.length) return;
      loadedFiles = Array.isArray(saved.files) ? saved.files : [];
      const records = saved.records
        .map((record, index) => reviveRecord(record, index))
        .filter(Boolean);
      refreshDashboard(records, `Restored ${records.length.toLocaleString()} unique records from ${loadedFiles.length.toLocaleString()} saved CSV file${loadedFiles.length === 1 ? "" : "s"}. Add newer CSV files to update the combined data.`, "success");
    } catch (error) {
      console.error(error);
      showStatus("Saved CSV data could not be restored. You can still upload files normally.", "warning");
    }
  }

  createLibraryUi();
  interceptUploads();
  restoreSavedData();
})();
