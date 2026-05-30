const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(express.json({ limit: "2mb" }));

app.use(cors({
  origin: "*"
}));

app.get("/", function(req, res){
  res.json({
    ok: true,
    service: "GoCarga Tracking Engine",
    version: "2.3",
    routes: ["/track-fedex", "/test-fedex", "/test-estes", "/track-estes", "/track-abf", "/track-dayton", "/track-tforce", "/track", "/track-aaa", "/debug-aaa", "/health"]
  });
});


app.get("/test-fedex", function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro || "302326317091");

  res.json({
    success: true,
    route: "/test-fedex",
    message: "FedEx route file is live. This does not scrape FedEx.",
    tracking: tracking,
    officialFedExUrl: "https://www.fedexfreight.com/fedextrack/?trknbr=" + encodeURIComponent(tracking) + "&trkqual=~" + encodeURIComponent(tracking) + "~FDFR",
    timestamp: new Date().toISOString()
  });
});



app.get("/test-estes", function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro || "1658318875");

  res.json({
    success: true,
    route: "/test-estes",
    message: "Estes route file is live. This does not scrape Estes.",
    tracking: tracking,
    officialEstesUrl: "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO",
    timestamp: new Date().toISOString()
  });
});


app.get("/health", function(req, res){
  res.json({
    success: true,
    ok: true,
    timestamp: new Date().toISOString()
  });
});


async function launchBrowser(){
  return await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

async function speedUpPage(page){
  await page.route("**/*", function(route){
    const request = route.request();
    const type = request.resourceType();

    if(type === "image" || type === "font" || type === "media"){
      return route.abort().catch(function(){});
    }

    return route.continue().catch(function(){});
  }).catch(function(){});
}

async function clickPossibleCookieButtons(page){
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('I Accept')",
    "button:has-text('Agree')",
    "button:has-text('OK')",
    "button:has-text('Close')"
  ];

  for(const selector of selectors){
    try{
      const button = page.locator(selector).first();
      if(await button.isVisible({ timeout: 800 })){
        await button.click({ force: true, timeout: 1500 }).catch(function(){});
        await page.waitForTimeout(500);
        return true;
      }
    } catch(error){}
  }

  return false;
}



function cleanTracking(value){
  return String(value || "").trim().replace(/\s+/g, "");
}

function withTimeout(promise, ms, label){
  let timer;

  const timeout = new Promise(function(resolve){
    timer = setTimeout(function(){
      resolve({
        success: false,
        found: false,
        timeout: true,
        reason: "TIMEOUT",
        error: label + " timed out after " + ms + "ms"
      });
    }, ms);
  });

  return Promise.race([promise, timeout]).then(function(result){
    clearTimeout(timer);
    return result;
  });
}

function cleanTextValue(value){
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactTrackingLines(value){
  return cleanTextValue(value)
    .split(/\n+/)
    .map(function(line){ return cleanTextValue(line); })
    .filter(Boolean);
}

function simpleMatch(text, patterns){
  for(const pattern of patterns){
    const match = String(text || "").match(pattern);
    if(match && match[1]){
      return cleanTextValue(match[1]);
    }
  }

  return "";
}

function lineAfterLabel(lines, labels){
  for(let i = 0; i < lines.length; i++){
    const current = String(lines[i] || "").toLowerCase();

    for(const label of labels){
      const lowerLabel = String(label || "").toLowerCase();

      if(current === lowerLabel && lines[i + 1]){
        return cleanTextValue(lines[i + 1]);
      }

      if(current.indexOf(lowerLabel + ":") >= 0){
        return cleanTextValue(lines[i].split(":").slice(1).join(":"));
      }
    }
  }

  return "";
}

function normalizeSimpleLocation(value){
  const display = cleanTextValue(value);

  if(!display){
    return {
      city: "",
      state: "",
      postal_code: "",
      country: "USA",
      display: ""
    };
  }

  const match = display.match(/^(.+?),\s*([A-Z]{2})(?:\s+(\d{5}))?(?:\s+(US|USA))?$/i);

  if(match){
    return {
      city: cleanTextValue(match[1]),
      state: cleanTextValue(match[2]).toUpperCase(),
      postal_code: cleanTextValue(match[3] || ""),
      country: "USA",
      display: display
    };
  }

  return {
    city: display,
    state: "",
    postal_code: "",
    country: "USA",
    display: display
  };
}

function normalizeSimpleStatus(value){
  const lower = String(value || "").toLowerCase();

  if(lower.indexOf("delivered") >= 0) return "Delivered";
  if(lower.indexOf("out for delivery") >= 0) return "Out For Delivery";
  if(lower.indexOf("on the way") >= 0 || lower.indexOf("in transit") >= 0 || lower.indexOf("departed") >= 0 || lower.indexOf("arrived") >= 0) return "In Transit";
  if(lower.indexOf("picked") >= 0 || lower.indexOf("received") >= 0 || lower.indexOf("picked up") >= 0) return "Picked Up";
  if(lower.indexOf("created") >= 0 || lower.indexOf("label") >= 0) return "Label Created";
  if(lower.indexOf("not found") >= 0 || lower.indexOf("no shipment") >= 0 || lower.indexOf("unable to locate") >= 0) return "Not Found";

  return cleanTextValue(value || "Tracking Found");
}

function normalizeSimpleState(status){
  const lower = String(status || "").toLowerCase();

  if(lower.indexOf("delivered") >= 0) return "delivered";
  if(lower.indexOf("out for delivery") >= 0) return "out_for_delivery";
  if(lower.indexOf("transit") >= 0 || lower.indexOf("on the way") >= 0) return "in_transit";
  if(lower.indexOf("picked") >= 0 || lower.indexOf("received") >= 0) return "picked_up";
  if(lower.indexOf("created") >= 0) return "received";
  if(lower.indexOf("not found") >= 0) return "not_found";

  return "tracking_pending";
}

function findLocationLine(lines){
  for(const line of lines){
    if(/^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?(?:\s+US| USA)?$/i.test(line)){
      return line;
    }
  }

  return "";
}

function findAnyDateTime(text){
  return simpleMatch(text, [
    /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:at\s*)?\d{1,2}:\d{2}\s*(?:AM|PM))/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  ]);
}

function normalizeSimpleEventTitle(value){
  const lower = String(value || "").toLowerCase();

  if(lower.indexOf("label") >= 0 || lower.indexOf("created") >= 0) return "From";
  if(lower.indexOf("picked") >= 0 || lower.indexOf("pickup") >= 0 || lower.indexOf("received") >= 0) return "We Have Your Shipment";
  if(lower.indexOf("departed") >= 0 || lower.indexOf("arrived") >= 0 || lower.indexOf("in transit") >= 0 || lower.indexOf("on the way") >= 0 || lower.indexOf("terminal") >= 0) return "On The Way";
  if(lower.indexOf("out for delivery") >= 0) return "Out For Delivery";
  if(lower.indexOf("delivered") >= 0) return "Delivered";

  return cleanTextValue(value || "Carrier Update");
}

function extractSimpleEvents(bodyText, carrierName){
  const text = String(bodyText || "");
  const lines = compactTrackingLines(text);
  const events = [];
  const eventWords = [
    "Label Created",
    "Shipment Created",
    "Picked Up",
    "Pickup",
    "Received",
    "In Transit",
    "On The Way",
    "Departed",
    "Arrived",
    "At Terminal",
    "Origin Terminal",
    "Destination Terminal",
    "Out For Delivery",
    "Delivered"
  ];

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    const found = eventWords.find(function(word){
      return line.toLowerCase().indexOf(word.toLowerCase()) >= 0;
    });

    if(!found) continue;

    const windowLines = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 7));
    const windowText = windowLines.join("\n");
    const locationLine = findLocationLine(windowLines);
    const time = findAnyDateTime(windowText);
    const normalizedStatus = normalizeSimpleEventTitle(found);

    if(!events.some(function(event){
      return event.status === normalizedStatus && event.timestamp === time && event.location.display === locationLine;
    })){
      events.push({
        status: normalizedStatus,
        description: cleanTextValue(line),
        location: normalizeSimpleLocation(locationLine || carrierName),
        timestamp: cleanTextValue(time || "Carrier update"),
        completed: true
      });
    }
  }

  if(!events.length){
    const status = normalizeSimpleStatus(text);
    events.push({
      status: status,
      description: carrierName + " returned tracking data.",
      location: normalizeSimpleLocation(carrierName),
      timestamp: findAnyDateTime(text) || "Carrier update",
      completed: true
    });
  }

  return events;
}

function extractSimpleFreightFacts(bodyText){
  const text = cleanTextValue(bodyText);
  const lines = compactTrackingLines(text);

  const handlingUnits = simpleMatch(text, [
    /handling\s*units?\s*:?\s*([0-9,]+)/i,
    /pieces?\s*:?\s*([0-9,]+)/i,
    /total\s*pieces?\s*:?\s*([0-9,]+)/i,
    /pcs\s*:?\s*([0-9,]+)/i
  ]) || lineAfterLabel(lines, ["Handling Units", "Pieces", "Total Pieces", "PCS"]);

  let shipmentWeight = simpleMatch(text, [
    /shipment\s*weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /total\s*weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i
  ]) || lineAfterLabel(lines, ["Shipment Weight", "Total Weight", "Weight"]);

  if(shipmentWeight && !/[a-z]/i.test(shipmentWeight)){
    shipmentWeight = shipmentWeight + " lbs";
  }

  const packagingType = simpleMatch(text, [
    /packaging\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /package\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /packaging\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i
  ]) || lineAfterLabel(lines, ["Packaging", "Package Type", "Packaging Type"]);

  const service = simpleMatch(text, [
    /service\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /service\s*type\s*:?\s*([A-Za-z0-9 \-/]+)/i,
    /service\s*level\s*:?\s*([A-Za-z0-9 \-/]+)/i
  ]) || lineAfterLabel(lines, ["Service", "Service Type", "Service Level"]);

  return {
    handlingUnits: handlingUnits,
    shipmentWeight: shipmentWeight,
    packagingType: packagingType,
    service: service
  };
}

function buildSimpleCarrierResponse(options){
  const carrierName = options.carrierName;
  const tracking = options.tracking;
  const bodyText = options.bodyText || "";
  const finalUrl = options.finalUrl || "";
  const text = cleanTextValue(bodyText);
  const lower = text.toLowerCase();

  const blocked = lower.indexOf("captcha") >= 0 || lower.indexOf("verify you are human") >= 0 || lower.indexOf("access denied") >= 0 || lower.indexOf("forbidden") >= 0;
  const notFound = lower.indexOf("not found") >= 0 || lower.indexOf("no shipment") >= 0 || lower.indexOf("unable to locate") >= 0 || lower.indexOf("no records") >= 0;

  const events = extractSimpleEvents(text, carrierName);
  const facts = extractSimpleFreightFacts(text);
  const deliveredEvent = events.slice().reverse().find(function(event){ return event.status === "Delivered"; });
  const currentEvent = events.slice().reverse().find(function(event){ return event.location && event.location.display; });
  const status = notFound ? "Not Found" : normalizeSimpleStatus((deliveredEvent && deliveredEvent.status) || text.slice(0, 500));
  const state = normalizeSimpleState(status);

  const originEvent = events.find(function(event){
    return event.location && event.location.display && event.status !== "Delivered";
  });

  const destinationEvent = events.slice().reverse().find(function(event){
    return event.location && event.location.display && (event.status === "Delivered" || event.status === "Out For Delivery" || event.status === "On The Way");
  });

  return {
    success: !blocked && !notFound,
    found: !blocked && !notFound,
    blocked: blocked,
    reason: blocked ? "CAPTCHA_OR_ACCESS_BLOCK" : notFound ? "NOT_FOUND" : "",
    carrier: carrierName,
    tracking: tracking,
    pro: tracking,
    status: status,
    state: state,
    statusCopy: status,
    service: facts.service || "LTL Freight",
    handlingUnits: facts.handlingUnits || "",
    shipmentWeight: facts.shipmentWeight || "",
    packagingType: facts.packagingType || "",
    eta: {
      date: deliveredEvent ? deliveredEvent.timestamp : "",
      time: deliveredEvent ? "Carrier delivery scan" : "",
      estimated: false
    },
    origin: originEvent ? originEvent.location : normalizeSimpleLocation(""),
    destination: destinationEvent ? destinationEvent.location : normalizeSimpleLocation(""),
    current_location: currentEvent ? currentEvent.location : normalizeSimpleLocation(""),
    delivery: {
      out_for_delivery: state === "out_for_delivery",
      delivered: state === "delivered"
    },
    events: events,
    carrier_tracking_url: finalUrl,
    officialTrackingUrl: finalUrl,
    parsed: {
      pro: tracking,
      status: status,
      service: facts.service || "",
      handlingUnits: facts.handlingUnits || "",
      shipmentWeight: facts.shipmentWeight || "",
      packagingType: facts.packagingType || "",
      travelHistory: events.map(function(event){
        return {
          status: event.status,
          description: event.description,
          location: event.location.display,
          time: event.timestamp
        };
      })
    },
    source: "Render " + carrierName,
    pageText: text.slice(0, 15000),
    debug: {
      title: options.title || "",
      url: finalUrl
    }
  };
}

async function scrapeDirectCarrier(options){
  const tracking = cleanTracking(options.tracking);
  const carrierName = options.carrierName;
  const url = options.url;
  const waitFor = options.waitFor || 10000;

  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    await speedUpPage(page);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await clickPossibleCookieButtons(page);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(function(){});
    await page.waitForTimeout(waitFor);

    const report = await getPageReport(page);
    const finalUrl = page.url();

    await browser.close();

    return buildSimpleCarrierResponse({
      carrierName: carrierName,
      tracking: tracking,
      bodyText: report && report.bodyText ? report.bodyText : "",
      finalUrl: finalUrl,
      title: report && report.title ? report.title : ""
    });

  } catch(error){
    if(browser){
      await browser.close().catch(function(){});
    }

    return {
      success: false,
      found: false,
      carrier: carrierName,
      tracking: tracking,
      error: error.message,
      reason: "SCRAPE_ERROR",
      finalUrl: url,
      events: []
    };
  }
}

async function scrapeFormCarrier(options){
  const tracking = cleanTracking(options.tracking);
  const carrierName = options.carrierName;
  const startUrl = options.startUrl;
  const waitFor = options.waitFor || 10000;
  const inputSelectors = options.inputSelectors || [];
  const buttonSelectors = options.buttonSelectors || [];

  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    await speedUpPage(page);

    await page.goto(startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(waitFor);

    const beforeReport = await getPageReport(page);
    const filled = await setInputValue(page, inputSelectors, tracking);

    if(!filled.success){
      throw new Error(carrierName + " tracking input was not found. Page report: " + JSON.stringify(beforeReport).slice(0, 2500));
    }

    await page.waitForTimeout(2000);

    const clicked = await clickBySelectors(page, buttonSelectors);

    if(!clicked.success){
      await page.keyboard.press("Enter").catch(function(){});
    }

    await page.waitForTimeout(12000);

    const report = await getPageReport(page);
    const finalUrl = page.url();

    await browser.close();

    return buildSimpleCarrierResponse({
      carrierName: carrierName,
      tracking: tracking,
      bodyText: report && report.bodyText ? report.bodyText : "",
      finalUrl: finalUrl,
      title: report && report.title ? report.title : ""
    });

  } catch(error){
    if(browser){
      await browser.close().catch(function(){});
    }

    return {
      success: false,
      found: false,
      carrier: carrierName,
      tracking: tracking,
      error: error.message,
      reason: "SCRAPE_ERROR",
      finalUrl: startUrl,
      events: []
    };
  }
}



async function getPageReport(page){
  const report = await page.evaluate(function(){
    const inputList = Array.from(document.querySelectorAll("input, textarea")).map(function(el, index){
      return {
        index: index,
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        id: el.getAttribute("id") || "",
        name: el.getAttribute("name") || "",
        placeholder: el.getAttribute("placeholder") || "",
        value: el.value || "",
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      };
    });

    const buttonList = Array.from(document.querySelectorAll("button, input[type='submit'], input[type='button'], a")).map(function(el, index){
      return {
        index: index,
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        id: el.getAttribute("id") || "",
        name: el.getAttribute("name") || "",
        value: el.getAttribute("value") || "",
        text: (el.innerText || el.textContent || "").trim().slice(0, 120),
        href: el.getAttribute("href") || "",
        visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
      };
    });

    const forms = Array.from(document.querySelectorAll("form")).map(function(el, index){
      return {
        index: index,
        id: el.getAttribute("id") || "",
        name: el.getAttribute("name") || "",
        action: el.getAttribute("action") || "",
        method: el.getAttribute("method") || ""
      };
    });

    return {
      title: document.title,
      url: window.location.href,
      bodyText: document.body ? document.body.innerText.slice(0, 15000) : "",
      inputs: inputList,
      buttons: buttonList,
      forms: forms
    };
  }).catch(function(error){
    return {
      error: error.message
    };
  });

  return report;
}

async function setInputValue(page, selectors, value){
  for(const frame of page.frames()){
    for(const selector of selectors){
      const count = await frame.locator(selector).count().catch(function(){
        return 0;
      });

      for(let i = 0; i < count; i++){
        const field = frame.locator(selector).nth(i);

        const visible = await field.isVisible().catch(function(){
          return false;
        });

        const enabled = await field.isEnabled().catch(function(){
          return false;
        });

        if(visible && enabled){
          await field.click({ force: true, timeout: 10000 }).catch(function(){});
          await field.fill("").catch(function(){});
          await field.type(value, { delay: 80 }).catch(async function(){
            await field.evaluate(function(el, inputValue){
              el.focus();
              el.value = inputValue;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "1" }));
              el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "1" }));
              el.blur();
            }, value);
          });

          await field.evaluate(function(el, inputValue){
            el.value = inputValue;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
          }, value);

          return {
            success: true,
            selector: selector,
            frameUrl: frame.url()
          };
        }
      }
    }
  }

  return {
    success: false
  };
}

async function clickBySelectors(page, selectors){
  for(const frame of page.frames()){
    for(const selector of selectors){
      const count = await frame.locator(selector).count().catch(function(){
        return 0;
      });

      for(let i = 0; i < count; i++){
        const button = frame.locator(selector).nth(i);

        const visible = await button.isVisible().catch(function(){
          return false;
        });

        const enabled = await button.isEnabled().catch(function(){
          return false;
        });

        if(visible && enabled){
          await button.click({ force: true, timeout: 10000 }).catch(async function(){
            await button.evaluate(function(el){
              el.click();
            });
          });

          return {
            success: true,
            selector: selector,
            frameUrl: frame.url()
          };
        }
      }
    }
  }

  return {
    success: false
  };
}

app.post("/track-abf", async function(req, res){
  const tracking = cleanTracking(req.body.tracking);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    });

    await page.goto("https://view.arcb.com/nlo/tools/tracking", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(14000);

    const filled = await setInputValue(page, [
      "input[aria-label*='Tracking']",
      "input[type='text']",
      "input[type='search']",
      "input:not([type])",
      "textarea",
      "input"
    ], tracking);

    if(!filled.success){
      throw new Error("ABF tracking input was not found");
    }

    await page.waitForTimeout(3000);

    const clicked = await clickBySelectors(page, [
      "button:has-text('Track Shipment')",
      "button:has-text('Track')",
      "input[type='submit']",
      "[role='button']:has-text('Track Shipment')",
      "[role='button']:has-text('Track')",
      "button"
    ]);

    if(!clicked.success){
      throw new Error("ABF Track Shipment button was not found");
    }

    await page.waitForTimeout(12000);

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      carrier: "ABF Freight",
      tracking: tracking,
      finalUrl: finalUrl
    });

  } catch(error){
    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      carrier: "ABF Freight",
      error: error.message,
      finalUrl: "https://view.arcb.com/nlo/tools/tracking"
    });
  }
});

app.post("/track-aaa", async function(req, res){
  const tracking = cleanTracking(req.body.tracking);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    await page.goto("https://www.aaacooper.com/pwb/Transit/ProTrackResults.aspx", {
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    const beforeReport = await getPageReport(page);

    const filled = await setInputValue(page, [
      "input[name='ProNum']",
      "input[id='ProNum']",
      "input[name='pronum']",
      "input[id='pronum']",
      "input[name*='Pro']",
      "input[id*='Pro']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[placeholder*='PRO']",
      "input[placeholder*='Pro']",
      "input[type='text']",
      "textarea",
      "input"
    ], tracking);

    if(!filled.success){
      throw new Error("AAA Cooper PRO input was not found. Page report: " + JSON.stringify(beforeReport).slice(0, 3000));
    }

    await page.waitForTimeout(2000);

    const afterFillReport = await getPageReport(page);

    const clicked = await clickBySelectors(page, [
      "input[type='submit'][value*='Track']",
      "input[type='submit'][value*='Submit']",
      "input[type='submit'][value*='Search']",
      "input[type='submit']",
      "button:has-text('Track')",
      "button:has-text('Submit')",
      "button:has-text('Search')",
      "a:has-text('Track')",
      "a:has-text('Submit')",
      "[role='button']:has-text('Track')",
      "[role='button']:has-text('Submit')",
      "button"
    ]);

    if(!clicked.success){
      await page.keyboard.press("Enter").catch(function(){});
    }

    await page.waitForTimeout(12000);

    const afterClickReport = await getPageReport(page);
    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      carrier: "AAA Cooper",
      tracking: tracking,
      finalUrl: finalUrl,
      debug: {
        filled: filled,
        clicked: clicked,
        before: beforeReport,
        afterFill: afterFillReport,
        afterClick: afterClickReport
      }
    });

  } catch(error){
    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      carrier: "AAA Cooper",
      error: error.message,
      finalUrl: "https://www.aaacooper.com/pwb/Transit/ProTrackResults.aspx"
    });
  }
});



function parseFedExFreightText(bodyText, tracking){
  const rawText = String(bodyText || "");
  const text = rawText.replace(/\s+/g, " ").trim();

  function cleanValue(value){
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\s+View travel history.*$/i, "")
      .replace(/\s+shipmentItem.*$/i, "")
      .replace(/\s+Back to top.*$/i, "")
      .trim();
  }

  function matchValue(pattern){
    const match = text.match(pattern);
    return match && match[1] ? cleanValue(match[1]) : "";
  }

  function cleanDateTime(value){
    return cleanValue(value)
      .replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(\d)/i, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  const lowerText = text.toLowerCase();

  const status = lowerText.indexOf("delivered") >= 0 ? "Delivered" :
    lowerText.indexOf("out for delivery") >= 0 ? "Out For Delivery" :
    lowerText.indexOf("on the way") >= 0 || lowerText.indexOf("in transit") >= 0 ? "In Transit" :
    lowerText.indexOf("picked up") >= 0 ? "Picked Up" :
    lowerText.indexOf("label created") >= 0 ? "Label Created" :
    "Tracking Found";

  const deliveredDateTime = cleanDateTime(matchValue(/DELIVERED\s+(.+?)\s+Signed for by:/i) ||
    matchValue(/Delivered\s+(.+?)\s+Signed for by:/i) ||
    matchValue(/DELIVERED\s+(.+?)\s+Services/i));

  const signedBy = matchValue(/Signed for by:\s+(.+?)\s+Obtain proof/i) ||
    matchValue(/Signed for by:\s+(.+?)\s+DELIVERY STATUS/i);

  const originTerminal = matchValue(/Origin Terminal\s+(.+?)\s+We have your shipment/i) ||
    matchValue(/Origin Terminal\s+(.+?)\s+Delivered/i);

  const destinationTerminal = matchValue(/Destination Terminal\s+(.+?)\s+View travel history/i) ||
    matchValue(/Destination Terminal\s+(.+?)\s+shipmentItem/i) ||
    matchValue(/Destination Terminal\s+(.+?)\s+Shipment facts/i);

  const service = matchValue(/Services\s+Service\s+(.+?)\s+Terms/i) ||
    matchValue(/Service\s+(.+?)\s+Terms/i);

  const billOfLading = matchValue(/Bill of lading number\s+(\S+)/i);
  const shipDate = matchValue(/Ship date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  const weight = matchValue(/Weight\s+(.+?)\s+Total number of handling units/i);
  const handlingUnits = matchValue(/Total number of handling units\s+(\d+)/i);
  const pieces = matchValue(/Total pieces\s+(\d+)/i);
  const totalShipmentWeight = matchValue(/Total shipment weight\s+(.+?)\s+Packaging/i);
  const packaging = matchValue(/Packaging\s+(.+?)\s+Origin piece count/i);

  const events = [];

  function addEvent(statusName, description, location, timestamp){
    events.push({
      status: cleanValue(statusName),
      description: cleanValue(description),
      location: cleanValue(location || "FedEx Freight"),
      timestamp: cleanDateTime(timestamp || "Carrier update"),
      completed: true
    });
  }

  const travelStart = rawText.indexOf("Travel History");
  const travelEnd = rawText.indexOf("Watch list");
  const travelText = travelStart >= 0 && travelEnd > travelStart ? rawText.slice(travelStart, travelEnd) : "";

  if(travelText){
    const lines = travelText
      .split(/\n+/)
      .map(function(line){ return cleanValue(line); })
      .filter(Boolean);

    let activeDate = "";

    for(let i = 0; i < lines.length; i++){
      const line = lines[i];

      if(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*\d{1,2}\/\d{1,2}\/\d{2,4}$/i.test(line)){
        activeDate = line;
        continue;
      }

      if(/^\d{1,2}:\d{2}\s*[AP]M$/i.test(line) && activeDate){
        const time = line;
        const statusLine = cleanValue(lines[i + 1] || "");
        let descriptionLine = "";
        let locationLine = "";

        if(lines[i + 2] && /^[A-Z][A-Z\s]+,\s*[A-Z]{2}$/i.test(lines[i + 2])){
          locationLine = cleanValue(lines[i + 2]);
          i += 2;
        } else if(lines[i + 3] && /^[A-Z][A-Z\s]+,\s*[A-Z]{2}$/i.test(lines[i + 3])){
          descriptionLine = cleanValue(lines[i + 2] || "");
          locationLine = cleanValue(lines[i + 3]);
          i += 3;
        } else {
          i += 1;
        }

        const statusName = statusLine || "FedEx Freight Update";
        const description = descriptionLine ? statusLine + " - " + descriptionLine : statusLine;

        if(statusName && statusName.toLowerCase().indexOf("date") < 0 && statusName.toLowerCase().indexOf("time zone") < 0){
          addEvent(statusName, description, locationLine || "FedEx Freight", activeDate + " " + time);
        }
      }
    }
  }

  if(!events.length && shipDate){
    addEvent("Ship Date", "Shipment date: " + shipDate, originTerminal || "FedEx Freight", shipDate);
  }

  if(originTerminal && !events.some(function(event){ return event.status.toLowerCase().indexOf("origin terminal") >= 0; })){
    addEvent("Origin Terminal", "Origin terminal: " + originTerminal, originTerminal, "Carrier update");
  }

  if(destinationTerminal && !events.some(function(event){ return event.status.toLowerCase().indexOf("destination terminal") >= 0; })){
    addEvent("Destination Terminal", "Destination terminal: " + destinationTerminal, destinationTerminal, "Carrier update");
  }

  if(deliveredDateTime && !events.some(function(event){ return event.status.toLowerCase() === "delivered"; })){
    addEvent("Delivered", signedBy ? "Signed by: " + signedBy : "Shipment delivered", destinationTerminal || "FedEx Freight", deliveredDateTime);
  }

  return {
    pro: tracking,
    status: status,
    deliveredDateTime: deliveredDateTime,
    signedBy: signedBy,
    originTerminal: originTerminal,
    destinationTerminal: destinationTerminal,
    service: service,
    weight: weight,
    handlingUnits: handlingUnits,
    pieces: pieces,
    billOfLading: billOfLading,
    shipDate: shipDate,
    totalShipmentWeight: totalShipmentWeight,
    packaging: packaging,
    events: events
  };
}


async function runFedExTracking(tracking){
  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    await speedUpPage(page);

    const directUrl = "https://www.fedexfreight.com/fedextrack/?trknbr=" + encodeURIComponent(tracking) + "&trkqual=~" + encodeURIComponent(tracking) + "~FDFR";

    await page.goto(directUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(10000);

    let report = await getPageReport(page);
    let bodyText = report && report.bodyText ? report.bodyText : "";
    let finalUrl = page.url();

    let found = false;
    let blocked = false;

    const lowerText = bodyText.toLowerCase();

    if(lowerText.indexOf("captcha") >= 0 || lowerText.indexOf("verify you are human") >= 0 || lowerText.indexOf("access denied") >= 0){
      blocked = true;
    }

    if(
      lowerText.indexOf("delivered") >= 0 ||
      lowerText.indexOf("in transit") >= 0 ||
      lowerText.indexOf("picked up") >= 0 ||
      lowerText.indexOf("shipment") >= 0 ||
      lowerText.indexOf("estimated delivery") >= 0 ||
      lowerText.indexOf(tracking.toLowerCase()) >= 0
    ){
      found = true;
    }

    if(!found && !blocked){
      const filled = await setInputValue(page, [
        "input[name*='trknbr']",
        "input[id*='trknbr']",
        "input[name*='tracking']",
        "input[id*='tracking']",
        "input[placeholder*='Tracking']",
        "input[placeholder*='tracking']",
        "input[placeholder*='PRO']",
        "input[type='text']",
        "input[type='search']",
        "textarea",
        "input"
      ], tracking);

      await page.waitForTimeout(1500);

      const clicked = await clickBySelectors(page, [
        "button:has-text('Track')",
        "button:has-text('TRACK')",
        "button:has-text('Submit')",
        "button:has-text('Search')",
        "input[type='submit']",
        "input[type='button']",
        "[role='button']:has-text('Track')",
        "[role='button']:has-text('Search')",
        "button"
      ]);

      if(!clicked.success){
        await page.keyboard.press("Enter").catch(function(){});
      }

      await page.waitForTimeout(12000);

      report = await getPageReport(page);
      bodyText = report && report.bodyText ? report.bodyText : "";
      finalUrl = page.url();

      const updatedLowerText = bodyText.toLowerCase();

      if(updatedLowerText.indexOf("captcha") >= 0 || updatedLowerText.indexOf("verify you are human") >= 0 || updatedLowerText.indexOf("access denied") >= 0){
        blocked = true;
      }

      if(
        updatedLowerText.indexOf("delivered") >= 0 ||
        updatedLowerText.indexOf("in transit") >= 0 ||
        updatedLowerText.indexOf("picked up") >= 0 ||
        updatedLowerText.indexOf("shipment") >= 0 ||
        updatedLowerText.indexOf("estimated delivery") >= 0 ||
        updatedLowerText.indexOf(tracking.toLowerCase()) >= 0
      ){
        found = true;
      }
    }

    await browser.close();

    return {
      success: true,
      carrier: "FedEx Freight",
      tracking: tracking,
      found: found,
      blocked: blocked,
      finalUrl: finalUrl,
      parsed: parseFedExFreightText(bodyText, tracking),
      pageText: bodyText.slice(0, 15000),
      debug: {
        title: report.title || "",
        url: report.url || finalUrl
      }
    };

  } catch(error){
    if(browser){
      await browser.close().catch(function(){});
    }

    return {
      success: false,
      carrier: "FedEx Freight",
      tracking: tracking,
      error: error.message,
      finalUrl: "https://www.fedexfreight.com/fedextrack/?trknbr=" + encodeURIComponent(tracking) + "&trkqual=~" + encodeURIComponent(tracking) + "~FDFR"
    };
  }
}

app.post("/track-fedex", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(runFedExTracking(tracking), 55000, "FedEx Freight tracking");
  return res.json(result);
});

app.get("/track-fedex", async function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(runFedExTracking(tracking), 55000, "FedEx Freight tracking");
  return res.json(result);
});



app.post("/track-estes", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "Estes Express",
    tracking: tracking,
    url: "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO",
    waitFor: 18000
  }), 55000, "Estes Express tracking");

  return res.json(result);
});

app.get("/track-estes", async function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "Estes Express",
    tracking: tracking,
    url: "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO",
    waitFor: 18000
  }), 55000, "Estes Express tracking");

  return res.json(result);
});

app.get("/track-abf", async function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeFormCarrier({
    carrierName: "ABF Freight",
    tracking: tracking,
    startUrl: "https://view.arcb.com/nlo/tools/tracking",
    waitFor: 9000,
    inputSelectors: [
      "input[aria-label*='Tracking']",
      "input[type='text']",
      "input[type='search']",
      "input:not([type])",
      "textarea",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Track Shipment')",
      "button:has-text('Track')",
      "input[type='submit']",
      "[role='button']:has-text('Track Shipment')",
      "[role='button']:has-text('Track')",
      "button"
    ]
  }), 27000, "ABF Freight tracking");

  return res.json(result);
});

app.post("/track-dayton", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "Dayton Freight",
    tracking: tracking,
    url: "https://tools.daytonfreight.com/tracking/detail/" + encodeURIComponent(tracking),
    waitFor: 10000
  }), 25000, "Dayton Freight tracking");

  return res.json(result);
});

app.get("/track-dayton", async function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "Dayton Freight",
    tracking: tracking,
    url: "https://tools.daytonfreight.com/tracking/detail/" + encodeURIComponent(tracking),
    waitFor: 10000
  }), 25000, "Dayton Freight tracking");

  return res.json(result);
});

app.post("/track-tforce", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "TForce Freight",
    tracking: tracking,
    url: "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking),
    waitFor: 11000
  }), 27000, "TForce Freight tracking");

  return res.json(result);
});

app.get("/track-tforce", async function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeDirectCarrier({
    carrierName: "TForce Freight",
    tracking: tracking,
    url: "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking),
    waitFor: 11000
  }), 27000, "TForce Freight tracking");

  return res.json(result);
});

app.post("/track", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);
  const carrier = String(req.body.carrier || req.query.carrier || "").toLowerCase();

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  if(carrier.indexOf("fedex") >= 0){
    const result = await withTimeout(runFedExTracking(tracking), 55000, "FedEx Freight tracking");
    return res.json(result);
  }

  if(carrier.indexOf("estes") >= 0){
    const result = await withTimeout(scrapeDirectCarrier({
      carrierName: "Estes Express",
      tracking: tracking,
      url: "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO",
      waitFor: 18000
    }), 55000, "Estes Express tracking");

    return res.json(result);
  }

  if(carrier.indexOf("abf") >= 0 || carrier.indexOf("arcb") >= 0){
    const result = await withTimeout(scrapeFormCarrier({
      carrierName: "ABF Freight",
      tracking: tracking,
      startUrl: "https://view.arcb.com/nlo/tools/tracking",
      waitFor: 9000,
      inputSelectors: [
        "input[aria-label*='Tracking']",
        "input[type='text']",
        "input[type='search']",
        "input:not([type])",
        "textarea",
        "input"
      ],
      buttonSelectors: [
        "button:has-text('Track Shipment')",
        "button:has-text('Track')",
        "input[type='submit']",
        "[role='button']:has-text('Track Shipment')",
        "[role='button']:has-text('Track')",
        "button"
      ]
    }), 27000, "ABF Freight tracking");

    return res.json(result);
  }

  if(carrier.indexOf("dayton") >= 0){
    const result = await withTimeout(scrapeDirectCarrier({
      carrierName: "Dayton Freight",
      tracking: tracking,
      url: "https://tools.daytonfreight.com/tracking/detail/" + encodeURIComponent(tracking),
      waitFor: 10000
    }), 25000, "Dayton Freight tracking");

    return res.json(result);
  }

  if(carrier.indexOf("tforce") >= 0 || carrier.indexOf("t-force") >= 0){
    const result = await withTimeout(scrapeDirectCarrier({
      carrierName: "TForce Freight",
      tracking: tracking,
      url: "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking),
      waitFor: 11000
    }), 27000, "TForce Freight tracking");

    return res.json(result);
  }

  return res.json({
    success: false,
    found: false,
    reason: "CARRIER_NOT_SELECTED",
    tracking: tracking,
    message: "Send carrier as FedEx Freight, Estes Express, ABF Freight, Dayton Freight, or TForce Freight."
  });
});

app.get("/track", async function(req, res){
  req.body = {
    tracking: req.query.tracking || req.query.pro,
    carrier: req.query.carrier
  };

  return app._router.handle(Object.assign(req, { method: "POST" }), res, function(){});
});


app.post("/debug-aaa", async function(req, res){
  const tracking = cleanTracking(req.body.tracking);

  let browser;

  try {
    browser = await launchBrowser();

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      viewport: {
        width: 1366,
        height: 768
      }
    });

    await page.goto("https://www.aaacooper.com/pwb/Transit/ProTrackResults.aspx", {
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    const beforeReport = await getPageReport(page);

    const filled = tracking ? await setInputValue(page, [
      "input[name='ProNum']",
      "input[id='ProNum']",
      "input[name='pronum']",
      "input[id='pronum']",
      "input[name*='Pro']",
      "input[id*='Pro']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[placeholder*='PRO']",
      "input[placeholder*='Pro']",
      "input[type='text']",
      "textarea",
      "input"
    ], tracking) : { success: false };

    await page.waitForTimeout(2000);

    const afterFillReport = await getPageReport(page);

    const clicked = tracking ? await clickBySelectors(page, [
      "input[type='submit'][value*='Track']",
      "input[type='submit'][value*='Submit']",
      "input[type='submit'][value*='Search']",
      "input[type='submit']",
      "button:has-text('Track')",
      "button:has-text('Submit')",
      "button:has-text('Search')",
      "a:has-text('Track')",
      "a:has-text('Submit')",
      "[role='button']:has-text('Track')",
      "[role='button']:has-text('Submit')",
      "button"
    ]) : { success: false };

    if(tracking && !clicked.success){
      await page.keyboard.press("Enter").catch(function(){});
    }

    await page.waitForTimeout(12000);

    const afterClickReport = await getPageReport(page);
    const screenshot = await page.screenshot({
      fullPage: true,
      type: "png"
    });

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      carrier: "AAA Cooper",
      tracking: tracking,
      finalUrl: finalUrl,
      filled: filled,
      clicked: clicked,
      before: beforeReport,
      afterFill: afterFillReport,
      afterClick: afterClickReport,
      screenshotBase64: screenshot.toString("base64")
    });

  } catch(error){
    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      carrier: "AAA Cooper",
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log("Server running on port " + port);
});
