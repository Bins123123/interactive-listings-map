#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const workbookPath = path.join(__dirname, "test.xlsx");
const brokerEmailCsvPath = path.join(__dirname, "broker-emails.csv");
const outputGeoJsonPath = path.join(__dirname, "locations.geojson");
const failedLogPath = path.join(__dirname, "failed.txt");
const envPath = path.join(__dirname, ".env");

async function loadEnvFile(filePath) {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function readZipEntry(zipPath, entryPath) {
  return execFileSync("unzip", ["-p", zipPath, entryPath], {
    encoding: "utf8"
  });
}

function listZipEntries(zipPath) {
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSharedStrings(xml) {
  const sharedStrings = [];
  const matches = xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);

  for (const match of matches) {
    const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXml(part[1]));
    sharedStrings.push(textParts.join(""));
  }

  return sharedStrings;
}

function columnLetters(cellRef) {
  const match = String(cellRef || "").match(/[A-Z]+/);
  return match ? match[0] : "";
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  const rowMatches = xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g);

  for (const rowMatch of rowMatches) {
    const rowNumber = Number(rowMatch[1]);
    const rowXml = rowMatch[2];
    const values = {};
    const cellMatches = rowXml.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g);

    for (const cellMatch of cellMatches) {
      const attributes = cellMatch[1] || cellMatch[2] || "";
      const body = cellMatch[3] || "";
      const refMatch = attributes.match(/\br="([^"]+)"/);
      if (!refMatch) {
        continue;
      }

      const ref = refMatch[1];
      const col = columnLetters(ref);
      const typeMatch = attributes.match(/\bt="([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : "";
      const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);

      let value = "";
      if (type === "s" && valueMatch) {
        value = sharedStrings[Number(valueMatch[1])] || "";
      } else if (type === "inlineStr" && inlineMatch) {
        value = decodeXml(inlineMatch[1]);
      } else if (valueMatch) {
        value = decodeXml(valueMatch[1]);
      }

      values[col] = String(value).trim();
    }

    rows.push({ rowNumber, values });
  }

  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ");
}

function normalizeBrokerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addUniqueEmail(lookup, key, email) {
  if (!key) {
    return;
  }

  if (!lookup.has(key)) {
    lookup.set(key, email);
  } else if (lookup.get(key) !== email) {
    // A fallback is safe only when it identifies one person.
    lookup.set(key, null);
  }
}

function brokerNameCandidates(value) {
  const normalized = normalizeBrokerName(value);
  if (!normalized) {
    return [];
  }

  const parts = normalized.split(" ");
  const candidates = new Set([normalized]);

  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    candidates.add(`${first[0]} ${last}`);
    candidates.add(last);

    // Supports source values formatted as "Last, First" as well as "First Last".
    candidates.add(`${last[0]} ${first}`);
    candidates.add(first);
  }

  return [...candidates];
}

function companyEmailCandidates(value) {
  const parts = normalizeBrokerName(value).split(" ").filter(Boolean);
  if (parts.length < 2) {
    return [];
  }

  const firstInitial = parts[0][0];
  const lastName = parts[parts.length - 1];
  return [`${firstInitial}${lastName}@binswanger.com`];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(value.trim());
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  if (row.some(Boolean)) {
    rows.push(row);
  }
  return rows;
}

async function loadBrokerEmailLookup(filePath) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("broker-emails.csv is required. Run download-sharepoint-file.js first.");
    }
    throw error;
  }

  const [headers, ...dataRows] = parseCsv(text);
  const normalizedHeaders = (headers || []).map(normalizeHeader);
  const brokerColumn = normalizedHeaders.findIndex((header) =>
    ["broker", "broker name", "name", "owner"].includes(header)
  );
  const firstNameColumn = normalizedHeaders.findIndex((header) =>
    ["first", "first name", "firstname"].includes(header)
  );
  const lastNameColumn = normalizedHeaders.findIndex((header) =>
    ["last", "last name", "lastname"].includes(header)
  );
  const emailColumn = normalizedHeaders.findIndex((header) =>
    ["email", "email address", "broker email"].includes(header)
  );

  if ((brokerColumn === -1 && (firstNameColumn === -1 || lastNameColumn === -1)) || emailColumn === -1) {
    throw new Error(
      "broker-emails.csv must include broker/name or first/last name columns, plus an email column."
    );
  }

  const exactMatches = new Map();
  const initialLastMatches = new Map();
  const lastNameMatches = new Map();
  const emailAddresses = new Set();
  for (const row of dataRows) {
    const firstName = String(row[firstNameColumn] || "").trim();
    const lastName = String(row[lastNameColumn] || "").trim();
    const brokerName = normalizeBrokerName(
      brokerColumn === -1 ? `${firstName} ${lastName}` : row[brokerColumn]
    );
    const email = String(row[emailColumn] || "").trim();
    if (brokerName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailAddresses.add(email.toLowerCase());
      addUniqueEmail(exactMatches, brokerName, email);

      const nameParts = brokerName.split(" ");
      const first = normalizeBrokerName(firstName) || nameParts[0];
      const last = normalizeBrokerName(lastName) || nameParts[nameParts.length - 1];
      if (first && last) {
        addUniqueEmail(initialLastMatches, `${first[0]} ${last}`, email);
        addUniqueEmail(lastNameMatches, last, email);
      }
    }
  }
  return { exactMatches, initialLastMatches, lastNameMatches, emailAddresses };
}

function findBrokerEmail(brokerName, brokerEmails) {
  const candidates = brokerNameCandidates(brokerName);
  const exactEmail = brokerEmails.exactMatches.get(candidates[0]);
  if (exactEmail) {
    return exactEmail;
  }

  for (const candidate of candidates) {
    const initialLastEmail = brokerEmails.initialLastMatches.get(candidate);
    if (initialLastEmail) {
      return initialLastEmail;
    }
  }

  for (const candidate of companyEmailCandidates(brokerName)) {
    if (brokerEmails.emailAddresses.has(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const lastNameEmail = brokerEmails.lastNameMatches.get(candidate);
    if (lastNameEmail) {
      return lastNameEmail;
    }
  }

  return "";
}

function findHeaderRow(rows, headerAliases) {
  for (const row of rows) {
    const normalizedByColumn = Object.fromEntries(
      Object.entries(row.values).map(([col, value]) => [col, normalizeHeader(value)])
    );

    for (const [fieldName, aliases] of Object.entries(headerAliases)) {
      const foundColumn = Object.entries(normalizedByColumn).find(([, value]) =>
        aliases.includes(value)
      );
      if (!foundColumn) {
        continue;
      }

      const columnMap = {};
      let foundAll = true;

      for (const [targetField, targetAliases] of Object.entries(headerAliases)) {
        const match = Object.entries(normalizedByColumn).find(([, value]) =>
          targetAliases.includes(value)
        );
        if (!match) {
          foundAll = false;
          break;
        }
        columnMap[targetField] = match[0];
      }

      if (foundAll) {
        return { rowNumber: row.rowNumber, columnMap };
      }
    }
  }

  return null;
}

function mapOptionalColumns(normalizedByColumn, optionalHeaderAliases) {
  const columnMap = {};

  for (const [targetField, targetAliases] of Object.entries(optionalHeaderAliases)) {
    const match = Object.entries(normalizedByColumn).find(([, value]) =>
      targetAliases.includes(value)
    );

    if (match) {
      columnMap[targetField] = match[0];
    }
  }

  return columnMap;
}

function parseAddress(rawAddress) {
  const parts = String(rawAddress || "")
    .split(/\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  const [cityState, streetAddress] = parts;
  if (!cityState || !streetAddress) {
    return null;
  }

  return { cityState, streetAddress };
}

const STREET_SUFFIX_PATTERN =
  /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|pl|place|way|pkwy|parkway|hwy|highway|trl|trail|ter|terrace)\b/i;

function getPrimaryGeocodeStreetAddress(streetAddress) {
  const normalizedStreetAddress = String(streetAddress || "").trim();
  const multiAddressMatch = normalizedStreetAddress.match(/^(.*?)\s+(?:&|and)\s+(\d[\s\S]*)$/i);

  if (!multiAddressMatch) {
    return normalizedStreetAddress;
  }

  const primaryStreetAddress = multiAddressMatch[1].trim();
  if (!STREET_SUFFIX_PATTERN.test(primaryStreetAddress)) {
    return normalizedStreetAddress;
  }

  return primaryStreetAddress;
}

function validateParsedAddress(rawAddress, parsedAddress) {
  const cityState = String(parsedAddress.cityState || "").trim();
  const streetAddress = String(parsedAddress.streetAddress || "").trim();

  if (!cityState || !streetAddress) {
    return "missing city/state or street address";
  }

  // Regional rollups like "NC, VA, TN" are not geocodable street addresses.
  if ((cityState.match(/,/g) || []).length > 1) {
    return "city/state looks like a region list, not a single place";
  }

  // Portfolio and rollup entries should be skipped instead of guessed.
  if (/\bportfolio\b/i.test(rawAddress) || /\bportfolio\b/i.test(streetAddress)) {
    return "portfolio entry is not a single street address";
  }

  // Parcel/block descriptions are too ambiguous to geocode reliably unless
  // they also include a conventional street suffix.
  if (/\bblock\b/i.test(streetAddress)) {
    const hasStreetSuffix = STREET_SUFFIX_PATTERN.test(streetAddress);
    if (!hasStreetSuffix) {
      return "parcel/block entry is not a normal street address";
    }
  }

  // For this dataset, valid listing addresses should include a street number.
  if (!/\d/.test(streetAddress)) {
    return "street address does not include a street number";
  }

  return "";
}

function buildProperties(rowValues, columnMap, parsedAddress, brokerEmails) {
  const owner = rowValues[columnMap.owner] || "";
  const dealName = rowValues[columnMap.addressDealNumber] || "";
  const recordType = rowValues[columnMap.recordType] || "";
  const askingPrice = rowValues[columnMap.askingPrice] || "";
  const leaseRate = rowValues[columnMap.leaseRate] || "";
  const listingEffectiveDate = rowValues[columnMap.listingEffectiveDate] || "";
  const listingExpirationDate = rowValues[columnMap.listingExpirationDate] || "";
  const squareFootage = rowValues[columnMap.squareFootage] || "";
  const leaseSquareFootage = columnMap.leaseSquareFootage
    ? (rowValues[columnMap.leaseSquareFootage] || "")
    : "";
  const acreage = columnMap.acreage ? (rowValues[columnMap.acreage] || "") : "";
  const address = `${parsedAddress.streetAddress}, ${parsedAddress.cityState}`;
  const brokerEmail = findBrokerEmail(owner, brokerEmails);

  return {
    Owner: owner,
    Property: dealName,
    "Deal: Deal Name": dealName,
    "Deal: Record Type": recordType,
    "Asking Price": askingPrice,
    "Lease Rate": leaseRate,
    "Listing Effective Date": listingEffectiveDate,
    "Listing Expiration Date": listingExpirationDate,
    "Square Footage": squareFootage,
    Acreage: acreage,
    "Lease Square Footage": leaseSquareFootage,
    broker_name: owner,
    broker_email: brokerEmail,
    address,
    city_state: parsedAddress.cityState,
    street_address: parsedAddress.streetAddress,
    deal_name: dealName,
    record_type: recordType,
    asking_price: askingPrice,
    lease_rate: leaseRate,
    listing_effective_date: listingEffectiveDate,
    listing_expiration_date: listingExpirationDate,
    square_footage: squareFootage,
    acreage,
    lease_square_footage: leaseSquareFootage
  };
}

async function geocodeAddress(query, mapboxToken) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${encodeURIComponent(mapboxToken)}` +
    "&limit=1&autocomplete=false";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mapbox returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const feature = payload.features && payload.features[0];
  if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) {
    return null;
  }

  return feature.center;
}

async function main() {
  await loadEnvFile(envPath);

  const mapboxToken = process.env.MAPBOX_TOKEN;
  if (!mapboxToken) {
    console.error("MAPBOX_TOKEN is required. Add it to .env or your shell environment.");
    process.exitCode = 1;
    return;
  }

  const brokerEmails = await loadBrokerEmailLookup(brokerEmailCsvPath);
  console.error(`Loaded ${brokerEmails.exactMatches.size} broker email record(s).`);

  const sharedStringsXml = readZipEntry(workbookPath, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const requiredHeaderAliases = {
    owner: ["owner"],
    addressDealNumber: ["deal: deal name", "property"],
    recordType: ["deal: record type"],
    askingPrice: ["asking price"],
    leaseRate: ["lease rate"],
    listingEffectiveDate: ["listing effective date"],
    listingExpirationDate: ["listing expiration date"],
    squareFootage: ["square footage"]
  };
  const optionalHeaderAliases = {
    leaseSquareFootage: ["lease square footage"],
    acreage: ["acreage"]
  };

  const worksheetEntries = listZipEntries(workbookPath)
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  let rows = [];
  let header = null;

  for (const worksheetEntry of worksheetEntries) {
    const candidateRows = parseWorksheet(readZipEntry(workbookPath, worksheetEntry), sharedStrings);
    const candidateHeader = findHeaderRow(candidateRows, requiredHeaderAliases);
    if (candidateHeader) {
      rows = candidateRows;
      header = candidateHeader;
      console.error(`Found listings headers in ${worksheetEntry}, row ${candidateHeader.rowNumber}.`);
      break;
    }
  }

  if (!header) {
    console.error("Could not find the expected header row in any worksheet in test.xlsx.");
    process.exitCode = 1;
    return;
  }

  const headerRow = rows.find((row) => row.rowNumber === header.rowNumber);
  const normalizedByColumn = Object.fromEntries(
    Object.entries(headerRow?.values || {}).map(([col, value]) => [col, normalizeHeader(value)])
  );
  header.columnMap = {
    ...header.columnMap,
    ...mapOptionalColumns(normalizedByColumn, optionalHeaderAliases)
  };

  const features = [];
  const failedRows = [];
  const geocodeFailureCounts = new Map();
  let geocodeAttempts = 0;
  let geocodeFailures = 0;
  let skippedRows = 0;

  for (const row of rows) {
    if (row.rowNumber <= header.rowNumber) {
      continue;
    }

    const rawAddress = row.values[header.columnMap.addressDealNumber] || "";
    if (!rawAddress) {
      continue;
    }

    const parsedAddress = parseAddress(rawAddress);
    if (!parsedAddress) {
      failedRows.push(`Row ${row.rowNumber}: could not parse address "${rawAddress}"`);
      continue;
    }

    const invalidReason = validateParsedAddress(rawAddress, parsedAddress);
    if (invalidReason) {
      failedRows.push(`Row ${row.rowNumber}: skipped "${rawAddress}" (${invalidReason})`);
      continue;
    }

    const geocodeStreetAddress = getPrimaryGeocodeStreetAddress(parsedAddress.streetAddress);
    const query = `${geocodeStreetAddress}, ${parsedAddress.cityState}`;
    const properties = buildProperties(row.values, header.columnMap, parsedAddress, brokerEmails);
    geocodeAttempts += 1;

    try {
      const coordinates = await geocodeAddress(query, mapboxToken);
      if (!coordinates) {
        geocodeFailures += 1;
        geocodeFailureCounts.set(
          "no geocoding result",
          (geocodeFailureCounts.get("no geocoding result") || 0) + 1
        );
        failedRows.push(`Row ${row.rowNumber}: no geocoding result for "${query}"`);
        continue;
      }

      features.push({
        type: "Feature",
        properties,
        geometry: {
          type: "Point",
          coordinates
        }
      });
    } catch (error) {
      geocodeFailures += 1;
      const failureReason = error && error.message ? error.message : "unknown error";
      geocodeFailureCounts.set(
        failureReason,
        (geocodeFailureCounts.get(failureReason) || 0) + 1
      );
      failedRows.push(`Row ${row.rowNumber}: geocoding failed for "${query}" (${error.message})`);
    }
  }

  skippedRows = failedRows.length - geocodeFailures;

  const systemicFailureReasons = [...geocodeFailureCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason}: ${count}`)
    .join("; ");
  const systemicGeocodeFailure =
    geocodeAttempts > 0 &&
    geocodeFailures === geocodeAttempts &&
    features.length === 0;

  if (systemicGeocodeFailure) {
    const summaryLines = [
      `Aborted update to avoid overwriting ${path.basename(outputGeoJsonPath)} with zero features.`,
      `Geocode attempts: ${geocodeAttempts}`,
      `Geocode failures: ${geocodeFailures}`,
      `Skipped rows before geocoding: ${Math.max(skippedRows, 0)}`,
      `Failure summary: ${systemicFailureReasons || "unknown"}`
    ];

    await fs.writeFile(failedLogPath, `${summaryLines.join("\n")}\n\n${failedRows.join("\n")}\n`, "utf8");
    console.error(summaryLines.join("\n"));
    process.exitCode = 1;
    return;
  }

  const geojson = {
    type: "FeatureCollection",
    features
  };

  await fs.writeFile(outputGeoJsonPath, `${JSON.stringify(geojson, null, 2)}\n`, "utf8");
  await fs.writeFile(
    failedLogPath,
    [
      `Geocode attempts: ${geocodeAttempts}`,
      `Features written: ${features.length}`,
      `Geocode failures: ${geocodeFailures}`,
      `Skipped rows before geocoding: ${Math.max(skippedRows, 0)}`,
      systemicFailureReasons ? `Failure summary: ${systemicFailureReasons}` : ""
    ].filter(Boolean).join("\n") + (failedRows.length ? `\n\n${failedRows.join("\n")}\n` : "\n"),
    "utf8"
  );

  console.error(`Wrote ${features.length} geocoded features to ${path.basename(outputGeoJsonPath)}.`);
  console.error(`Logged ${failedRows.length} failed rows to ${path.basename(failedLogPath)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
