(() => {
  const NON_BASE_SUFFIX = /-(?:EXT|EEX|OS|EOS)$/i;

  function hasNonBaseTicketSuffix(record) {
    const ticket = typeof cleanCell === "function"
      ? cleanCell(record?.ticket)
      : String(record?.ticket || "").trim();
    return NON_BASE_SUFFIX.test(ticket);
  }

  const previousIsExtensionRecord = typeof isExtensionRecord === "function"
    ? isExtensionRecord
    : null;

  // Safety Park uses all four suffixes for follow-up/add-on transactions.
  // They still count toward collected revenue, but they must not be treated as
  // a new car, a base purchase, or evidence that a normal duration was offered
  // at the add-on amount.
  window.isNonBaseTicketRecord = function isNonBaseTicketRecord(record) {
    if (hasNonBaseTicketSuffix(record)) return true;
    return previousIsExtensionRecord ? previousIsExtensionRecord(record) : false;
  };

  // Reassign the global binding used by classifyTicketType(), occupancy,
  // comparable-demand calculations, recommendations, and price-outlier scans.
  isExtensionRecord = window.isNonBaseTicketRecord;
})();
