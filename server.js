const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

const carrierConfig = {
  fedex: {
    name: "FedEx Freight",
    url: tracking => `https://www.fedexfreight.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}&trkqual=~${encodeURIComponent(tracking)}~FDFR`,
    waitFor: 12000
  },
  estes: {
    name: "Estes Express",
    url: tracking => `https://www.estes-express.com/myestes/shipment-tracking/?query=${encodeURIComponent(tracking)}&type=PRO`,
    waitFor: 12000
  },
  abf: {
    name: "ABF Freight",
    url: tracking => `https://view.arcb.com/nlo/tools/tracking/${encodeURIComponent(tracking)}`,
    waitFor: 12000
  },
  dayton: {
    name: "Dayton Freight",
    url: tracking => `https://tools.daytonfreight.com/tracking/detail/${encodeURIComponent(tracking)}`,
    waitFor: 12000
  },
  tforce: {
    name: "TForce Freight",
    url: tracking => `https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=${encodeURIComponent(tracking)}`,
    waitFor: 14000
  }
};

function cleanTracking(value) {
  return String(value || "").replace(/[^a-zA-Z0-9-]/g, "").trim().slice(0, 50);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactLines(value) {
  return cleanText(value)
    .split("\n")
    .map(line => cleanText(line))
    .filter(Boolean);
}

function normalizeCarrierKey(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("fedex")) return "fedex";
  if (text.includes("estes")) return "estes";
  if (text.includes("abf") || text.includes("arcb")) return "abf";
  if (text.includes("dayton")) return "dayton";
  if (text.includes("tforce") || text.includes("t-force") || text.includes("ups freight")) return "tforce";
  return "";
}

function detectCarrierByTracking(tracking) {
  const clean = cleanTracking(tracking);
  if (/^(107|302|724|840)/.test(clean) && clean.length >= 9) return "fedex";
  if (/^(07|078|16|165|21)/.test(clean) && clean.length >= 9) return "estes";
  if (/^(03|039|06|062|064|15|151|16|165|31|316)/.test(clean) && clean.length >= 8) return "abf";
  if (/^(80|808|90|901)/.test(clean) && clean.length >= 9) return "dayton";
  if (/^(48|50|52|56|57|59|60|61|63|65)/.test(clean) && clean.length >= 9) return "tforce";
  return "";
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return cleanText(match[1]);
  }
  return "";
}

function findLineValue(lines, labels) {
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const label of labels) {
      const labelLower = label.toLowerCase();
      if (lower === labelLower && lines[i + 1]) return lines[i + 1];
      if (lower.startsWith(labelLower + ":")) return cleanText(lines[i].slice(label.length + 1));
      if (lower.includes(labelLower + ":")) {
        const parts = lines[i].split(":");
        if (parts.length > 1) return cleanText(parts.slice(1).join(":"));
      }
    }
  }
  return "";
}

function parseLocation(value) {
  const text = cleanText(value);
  if (!text) {
    return {
      city: "",
      state: "",
      postal_code: "",
      country: "USA",
      display: ""
    };
  }

  const display = text.replace(/\s+View travel history.*$/i, "").trim();
  const match = display.match(/^(.+?),\s*([A-Z]{2})(?:\s+(\d{5}))?(?:\s+(US|USA))?$/i);

  if (match) {
    return {
      city: cleanText(match[1]),
      state: cleanText(match[2]).toUpperCase(),
      postal_code: cleanText(match[3] || ""),
      country: "USA",
      display
    };
  }

  return {
    city: display,
    state: "",
    postal_code: "",
    country: "USA",
    display
  };
}

function normalizeStatus(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("delivered")) return "Delivered";
  if (lower.includes("out for delivery")) return "Out For Delivery";
  if (lower.includes("on the way")) return "On The Way";
  if (lower.includes("in transit")) return "In Transit";
  if (lower.includes("picked up") || lower.includes("pickup") || lower.includes("we have your shipment")) return "We Have Your Shipment";
  if (lower.includes("label created") || lower.includes("shipment created")) return "Label Created";
  if (lower.includes("not found")) return "Not Found";
  return cleanText(text || "Tracking Found");
}

function normalizeState(status) {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("delivered")) return "delivered";
  if (lower.includes("out for delivery")) return "out_for_delivery";
  if (lower.includes("on the way") || lower.includes("in transit")) return "in_transit";
  if (lower.includes("picked") || lower.includes("we have your shipment")) return "picked_up";
  if (lower.includes("label created")) return "received";
  if (lower.includes("not found")) return "not_found";
  return "tracking_pending";
}

function extractHandlingUnits(text, lines) {
  return firstMatch(text, [
    /handling\s*units?\s*:?\s*([0-9,]+)/i,
    /pieces?\s*:?\s*([0-9,]+)/i,
    /total\s*pieces?\s*:?\s*([0-9,]+)/i,
    /number\s*of\s*pieces?\s*:?\s*([0-9,]+)/i,
    /pcs\s*:?\s*([0-9,]+)/i
  ]) || findLineValue(lines, ["Handling Units", "Pieces", "Total Pieces", "Number of Pieces", "PCS"]);
}

function extractWeight(text, lines) {
  const value = firstMatch(text, [
    /shipment\s*weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /total\s*weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i
  ]) || findLineValue(lines, ["Shipment Weight", "Total Weight", "Weight"]);

  if (!value) return "";
  if (/[a-z]/i.test(value)) return value;
  return `${value} lbs`;
}

function extractPackaging(text, lines) {
  return firstMatch(text, [
    /packaging\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /package\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /packaging\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i
  ]) || findLineValue(lines, ["Packaging", "Package Type", "Packaging Type"]);
}

function extractService(text, lines, carrierName) {
  const service = firstMatch(text, [
    /service\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /service\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /service\s*level\s*:?\s*([A-Za-z0-9 \-/]+)/i
  ]) || findLineValue(lines, ["Service", "Service Type", "Service Level"]);

  if (service) return cleanServiceName(service, carrierName);

  if (/priority/i.test(text) && /fedex/i.test(carrierName)) return "FedEx Priority";
  if (/economy/i.test(text) && /fedex/i.test(carrierName)) return "FedEx Economy";

  return "";
}

function cleanServiceName(service, carrier) {
  const text = cleanText(service);
  const c = String(carrier || "").toLowerCase();

  if (c.includes("fedex")) {
    if (/priority/i.test(text)) return "FedEx Priority";
    if (/economy/i.test(text)) return "FedEx Economy";
    if (/freight/i.test(text)) return "FedEx Freight";
  }

  return text;
}

function extractSignedBy(text, lines) {
  return firstMatch(text, [
    /signed\s*by\s*:?\s*([A-Za-z0-9 .'-]+)/i,
    /received\s*by\s*:?\s*([A-Za-z0-9 .'-]+)/i,
    /delivery\s*recipient\s*:?\s*([A-Za-z0-9 .'-]+)/i
  ]) || findLineValue(lines, ["Signed By", "Received By", "Delivery Recipient"]);
}

function extractDateTime(text) {
  return firstMatch(text, [
    /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  ]);
}

function eventFromLines(title, location, time, description) {
  return {
    status: normalizeEventTitle(title),
    description: cleanText(description || title),
    location: parseLocation(location || ""),
    timestamp: cleanText(time || ""),
    completed: true
  };
}

function normalizeEventTitle(value) {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  if (lower.includes("label created") || lower === "ship date" || lower === "from") return "From";
  if (lower.includes("we have your shipment") || lower.includes("pickup") || lower.includes("picked up") || lower.includes("received")) return "We Have Your Shipment";
  if (lower.includes("on the way") || lower.includes("in transit") || lower.includes("linehaul") || lower.includes("departed") || lower.includes("arrived")) return "On The Way";
  if (lower.includes("out for delivery")) return "Out For Delivery";
  if (lower.includes("delivered")) return "Delivered";
  if (lower.includes("origin terminal")) return "Origin Terminal";
  if (lower.includes("destination terminal")) return "Destination Terminal";
  return text || "Carrier Update";
}

function extractEvents(text, lines, carrierName) {
  const events = [];
  const eventWords = [
    "Label Created",
    "Ship Date",
    "We Have Your Shipment",
    "Picked Up",
    "Pickup",
    "Received",
    "On The Way",
    "In Transit",
    "Departed",
    "Arrived",
    "Origin Terminal",
    "Destination Terminal",
    "Out For Delivery",
    "Delivered",
    "Delivery"
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const found = eventWords.find(word => line.toLowerCase().includes(word.toLowerCase()));
    if (!found) continue;

    const windowLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 6));
    const windowText = windowLines.join("\n");
    const time = extractDateTime(windowText);
    const location = windowLines.find(item => /^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?(?:\s+US| USA)?$/i.test(item)) || "";
    const title = normalizeEventTitle(found);

    if (!events.some(event => event.status === title && event.timestamp === time && event.location.display === location)) {
      events.push(eventFromLines(title, location, time, line));
    }
  }

  if (!events.length) {
    const deliveredDateTime = extractDateTime(text);
    const status = normalizeStatus(text);

    events.push({
      status,
      description: `${carrierName} returned tracking data.`,
      location: parseLocation(""),
      timestamp: deliveredDateTime || "Carrier update",
      completed: true
    });
  }

  return events;
}

function extractOriginDestination(text, lines, events) {
  const originValue = firstMatch(text, [
    /origin\s*terminal\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i,
    /origin\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i,
    /from\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i
  ]) || findLineValue(lines, ["Origin Terminal", "Origin", "From"]);

  const destinationValue = firstMatch(text, [
    /destination\s*terminal\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i,
    /destination\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i,
    /to\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2})/i
  ]) || findLineValue(lines, ["Destination Terminal", "Destination", "To"]);

  const originEvent = events.find(event => ["From", "Origin Terminal", "We Have Your Shipment"].includes(event.status) && event.location.display);
  const destinationEvent = [...events].reverse().find(event => ["Delivered", "Destination Terminal", "Out For Delivery"].includes(event.status) && event.location.display);

  return {
    origin: parseLocation(originValue || (originEvent && originEvent.location.display) || ""),
    destination: parseLocation(destinationValue || (destinationEvent && destinationEvent.location.display) || "")
  };
}

function buildResult({ tracking, carrierKey, carrierName, finalUrl, text, title, html }) {
  const cleaned = cleanText(text);
  const lines = compactLines(cleaned);
  const blocked = /captcha|robot|verify you are human|access denied|forbidden/i.test(cleaned);
  const notFound = /not found|no shipment|unable to locate|invalid|no records/i.test(cleaned);
  const events = extractEvents(cleaned, lines, carrierName);
  const route = extractOriginDestination(cleaned, lines, events);
  const signedBy = extractSignedBy(cleaned, lines);
  const deliveredEvent = [...events].reverse().find(event => event.status === "Delivered");
  const status = notFound ? "Not Found" : normalizeStatus((deliveredEvent && deliveredEvent.status) || findLineValue(lines, ["Status", "Shipment Status", "Delivery Status"]) || cleaned.slice(0, 400));
  const deliveredDateTime = (deliveredEvent && deliveredEvent.timestamp) || (status === "Delivered" ? extractDateTime(cleaned) : "");
  const currentEvent = [...events].reverse().find(event => event.location && event.location.display);
  const service = extractService(cleaned, lines, carrierName);
  const handlingUnits = extractHandlingUnits(cleaned, lines);
  const shipmentWeight = extractWeight(cleaned, lines);
  const packagingType = extractPackaging(cleaned, lines);

  return {
    success: !blocked && !notFound,
    found: !blocked && !notFound,
    blocked,
    reason: blocked ? "CAPTCHA_OR_ACCESS_BLOCK" : notFound ? "NOT_FOUND" : "",
    tracking,
    carrier: carrierName,
    carrierKey,
    service,
    status,
    state: normalizeState(status),
    statusCopy: signedBy ? `Signed by: ${signedBy}.` : status,
    handlingUnits,
    shipmentWeight,
    packagingType,
    eta: {
      date: deliveredDateTime || "",
      time: deliveredDateTime ? "Carrier delivery scan" : "",
      estimated: false
    },
    origin: route.origin,
    destination: route.destination,
    current_location: currentEvent ? currentEvent.location : route.destination,
    delivery: {
      out_for_delivery: status === "Out For Delivery",
      delivered: status === "Delivered"
    },
    events,
    carrier_tracking_url: finalUrl,
    officialTrackingUrl: finalUrl,
    parsed: {
      pro: tracking,
      status,
      signedBy,
      service,
      handlingUnits,
      shipmentWeight,
      packagingType,
      deliveredDateTime,
      originTerminal: route.origin.display,
      destinationTerminal: route.destination.display,
      travelHistory: events.map(event => ({
        status: event.status,
        description: event.description,
        location: event.location.display,
        time: event.timestamp
      }))
    },
    source: `Render ${carrierName}`,
    raw: {
      title,
      finalUrl,
      textSample: cleaned.slice(0, 12000)
    }
  };
}

async function scrapeCarrier(tracking, carrierKey) {
  const config = carrierConfig[carrierKey];
  if (!config) {
    return {
      success: false,
      found: false,
      reason: "UNSUPPORTED_CARRIER",
      tracking,
      carrier: carrierKey || "",
      events: []
    };
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  let page;

  try {
    page = await browser.newPage({
      viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });

    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9"
    });

    const url = config.url(tracking);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    await page.waitForTimeout(config.waitFor);

    await acceptCookies(page);
    await expandPossibleTrackingSections(page);
    await page.waitForTimeout(1500);

    const title = await page.title().catch(() => "");
    const finalUrl = page.url();
    const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
    const html = await page.content().catch(() => "");

    return buildResult({
      tracking,
      carrierKey,
      carrierName: config.name,
      finalUrl,
      text,
      title,
      html
    });
  } catch (error) {
    return {
      success: false,
      found: false,
      reason: "SCRAPE_ERROR",
      error: String(error && error.message ? error.message : error),
      tracking,
      carrier: config.name,
      carrierKey,
      events: [],
      source: `Render ${config.name}`
    };
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function acceptCookies(page) {
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('I Accept')",
    "button:has-text('Agree')",
    "button:has-text('OK')"
  ];

  for (const selector of selectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 1000 })) {
        await button.click({ timeout: 2000 });
        await page.waitForTimeout(700);
        return;
      }
    } catch (error) {}
  }
}

async function expandPossibleTrackingSections(page) {
  const labels = [
    "View travel history",
    "Travel history",
    "Show details",
    "Shipment details",
    "More details",
    "Tracking details",
    "Details",
    "History",
    "Expand",
    "View More"
  ];

  for (const label of labels) {
    try {
      const items = await page.locator(`text=${label}`).all();
      for (const item of items.slice(0, 4)) {
        try {
          if (await item.isVisible({ timeout: 600 })) {
            await item.click({ timeout: 1200 });
            await page.waitForTimeout(500);
          }
        } catch (error) {}
      }
    } catch (error) {}
  }

  const buttons = await page.locator("button, [role='button'], a").all().catch(() => []);
  for (const button of buttons.slice(0, 25)) {
    try {
      const text = cleanText(await button.innerText({ timeout: 300 }));
      if (/travel|history|detail|more|expand|show/i.test(text)) {
        await button.click({ timeout: 1000 });
        await page.waitForTimeout(400);
      }
    } catch (error) {}
  }
}

async function handleCarrier(req, res, carrierKey) {
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.query.pro || req.body.pro);

  if (!tracking) {
    res.status(400).json({
      success: false,
      found: false,
      reason: "MISSING_TRACKING",
      message: "Tracking number is required."
    });
    return;
  }

  const result = await scrapeCarrier(tracking, carrierKey);
  res.json(result);
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "GoCarga Tracking Engine",
    version: "2.0",
    carriers: Object.values(carrierConfig).map(carrier => carrier.name),
    endpoints: ["/track", "/track-fedex", "/track-estes", "/track-abf", "/track-dayton", "/track-tforce"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    ok: true,
    timestamp: new Date().toISOString()
  });
});

app.post("/track", async (req, res) => {
  const tracking = cleanTracking(req.body.tracking || req.body.pro || req.query.tracking || req.query.pro);
  const requestedCarrier = normalizeCarrierKey(req.body.carrier || req.query.carrier);
  const carrierKey = requestedCarrier || detectCarrierByTracking(tracking);

  if (!tracking) {
    res.status(400).json({
      success: false,
      found: false,
      reason: "MISSING_TRACKING",
      message: "Tracking number is required."
    });
    return;
  }

  if (!carrierKey || !carrierConfig[carrierKey]) {
    res.json({
      success: false,
      found: false,
      reason: "CARRIER_NOT_DETECTED",
      tracking,
      carrier: "",
      message: "Carrier could not be confidently detected. Send carrier with the request.",
      supportedCarriers: Object.values(carrierConfig).map(carrier => carrier.name)
    });
    return;
  }

  const result = await scrapeCarrier(tracking, carrierKey);
  res.json(result);
});

app.get("/track", async (req, res) => {
  req.body = req.body || {};
  req.body.tracking = req.query.tracking || req.query.pro || req.body.tracking;
  req.body.carrier = req.query.carrier || req.body.carrier;
  const tracking = cleanTracking(req.body.tracking);
  const requestedCarrier = normalizeCarrierKey(req.body.carrier);
  const carrierKey = requestedCarrier || detectCarrierByTracking(tracking);

  if (!tracking) {
    res.status(400).json({
      success: false,
      found: false,
      reason: "MISSING_TRACKING",
      message: "Tracking number is required."
    });
    return;
  }

  if (!carrierKey || !carrierConfig[carrierKey]) {
    res.json({
      success: false,
      found: false,
      reason: "CARRIER_NOT_DETECTED",
      tracking,
      carrier: "",
      message: "Carrier could not be confidently detected. Send carrier with the request.",
      supportedCarriers: Object.values(carrierConfig).map(carrier => carrier.name)
    });
    return;
  }

  const result = await scrapeCarrier(tracking, carrierKey);
  res.json(result);
});

app.post("/track-fedex", (req, res) => handleCarrier(req, res, "fedex"));
app.get("/track-fedex", (req, res) => handleCarrier(req, res, "fedex"));

app.post("/track-estes", (req, res) => handleCarrier(req, res, "estes"));
app.get("/track-estes", (req, res) => handleCarrier(req, res, "estes"));

app.post("/track-abf", (req, res) => handleCarrier(req, res, "abf"));
app.get("/track-abf", (req, res) => handleCarrier(req, res, "abf"));

app.post("/track-dayton", (req, res) => handleCarrier(req, res, "dayton"));
app.get("/track-dayton", (req, res) => handleCarrier(req, res, "dayton"));

app.post("/track-tforce", (req, res) => handleCarrier(req, res, "tforce"));
app.get("/track-tforce", (req, res) => handleCarrier(req, res, "tforce"));

app.use((req, res) => {
  res.status(404).json({
    success: false,
    reason: "NOT_FOUND",
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log(`GoCarga Tracking Engine running on port ${PORT}`);
});
