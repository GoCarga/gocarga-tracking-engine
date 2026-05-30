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
    version: "2.9",
    routes: ["/track-fedex", "/test-fedex", "/test-estes", "/test-tforce", "/track-estes", "/track-abf", "/track-dayton", "/track-tforce", "/track", "/track-aaa", "/debug-aaa", "/health"]
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



app.get("/test-tforce", function(req, res){
  const tracking = cleanTracking(req.query.tracking || req.query.pro || "571887886");

  res.json({
    success: true,
    route: "/test-tforce",
    message: "TForce route file is live. This does not scrape TForce.",
    tracking: tracking,
    officialTForceUrl: "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking),
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
    "#onetrust-accept-btn-handler",
    "button#onetrust-accept-btn-handler",
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
      if(await button.isVisible({ timeout: 1200 })){
        await button.click({ force: true, timeout: 2000 }).catch(function(){});
        await page.waitForTimeout(800);
        return true;
      }
    } catch(error){}
  }

  try{
    await page.evaluate(function(){
      const banner = document.querySelector("#onetrust-banner-sdk");
      if(banner){banner.remove();}
      const overlay = document.querySelector(".onetrust-pc-dark-filter");
      if(overlay){overlay.remove();}
    });
  } catch(error){}

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


async function expandEstesDetails(page){
  const selectors = [
    "button:has-text('Expand All')",
    "a:has-text('Expand All')",
    "[role='button']:has-text('Expand All')",
    "button:has-text('Expand')",
    "[aria-label*='Expand']",
    "button[aria-label*='Expand']",
    ".accordion button",
    "button"
  ];

  for(const selector of selectors){
    try{
      const items = await page.locator(selector).all();
      for(const item of items.slice(0, 8)){
        try{
          const text = cleanText(await item.innerText({ timeout: 500 }).catch(function(){ return ""; }));
          const label = await item.getAttribute("aria-label").catch(function(){ return ""; });
          if(/expand/i.test(text) || /expand/i.test(label || "")){
            if(await item.isVisible({ timeout: 800 })){
              await item.click({ force: true, timeout: 2500 }).catch(async function(){
                await item.evaluate(function(el){ el.click(); }).catch(function(){});
              });
              await page.waitForTimeout(2500);
              return true;
            }
          }
        } catch(error){}
      }
    } catch(error){}
  }

  try{
    await page.evaluate(function(){
      const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
      const expand = candidates.find(function(el){
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
        return /expand all|expand/i.test(text);
      });

      if(expand){
        expand.click();
        return true;
      }

      return false;
    });
    await page.waitForTimeout(2500);
  } catch(error){}

  return false;
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




async function scrapeEstesTracking(tracking){
  tracking = cleanTracking(tracking);
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

    await page.goto("https://www.estes-express.com/myestes/shipment-tracking/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await clickPossibleCookieButtons(page);
    await page.waitForTimeout(3000);

    const filled = await setInputValue(page, [
      "textarea",
      "textarea[placeholder*='tracking']",
      "textarea[aria-label*='tracking']",
      "textarea[name*='tracking']",
      "textarea[id*='tracking']",
      "input[placeholder*='tracking']",
      "input[placeholder*='Tracking']",
      "input[aria-label*='tracking']",
      "input[aria-label*='Tracking']",
      "input[type='search']",
      "input[type='text']",
      "input"
    ], tracking);

    if(!filled.success){
      const beforeReport = await getPageReport(page);
      throw new Error("Estes tracking input was not found. Page report: " + JSON.stringify(beforeReport).slice(0, 2500));
    }

    await page.waitForTimeout(1200);

    const clicked = await clickBySelectors(page, [
      "button:has-text('SEARCH')",
      "button:has-text('Search')",
      "button:has-text('Track')",
      "input[type='submit']",
      "[role='button']:has-text('SEARCH')",
      "[role='button']:has-text('Search')",
      "[role='button']:has-text('Track')",
      "button"
    ]);

    if(!clicked.success){
      await page.keyboard.press("Enter").catch(function(){});
    }

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(function(){});
    await page.waitForTimeout(8000);

    await expandEstesDetails(page);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(function(){});
    await page.waitForTimeout(6000);

    const report = await getPageReport(page);
    const finalUrl = page.url();

    await browser.close();

    return buildEstesCarrierResponse({
      carrierName: "Estes Express",
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
      carrier: "Estes Express",
      tracking: tracking,
      error: error.message,
      reason: "SCRAPE_ERROR",
      finalUrl: "https://www.estes-express.com/myestes/shipment-tracking/",
      events: []
    };
  }
}

function buildEstesCarrierResponse(options){
  const text = cleanTextValue(options.bodyText || "");
  const tracking = cleanTracking(options.tracking);
  const finalUrl = options.finalUrl || "https://www.estes-express.com/myestes/shipment-tracking/";
  const cookieOnly = text.indexOf("Shipment Tracking") >= 0 &&
    text.indexOf("Enter tracking numbers") >= 0 &&
    text.indexOf("Tracking Results") < 0;

  const row = parseEstesResultsRow(text, tracking);
  const details = parseEstesExpandedDetails(text, tracking);
  const hasResults = !!row.pro || !!details.pro;

  if(cookieOnly || !hasResults){
    return {
      success: false,
      found: false,
      blocked: false,
      reason: "ESTES_SEARCH_NOT_SUBMITTED",
      carrier: "Estes Express",
      tracking: tracking,
      pro: tracking,
      status: "Tracking Pending",
      state: "tracking_pending",
      statusCopy: "Estes page loaded, but shipment details were not returned.",
      service: "",
      handlingUnits: "",
      shipmentWeight: "",
      packagingType: "",
      eta: {
        date: "",
        time: "",
        estimated: false
      },
      origin: normalizeSimpleLocation(""),
      destination: normalizeSimpleLocation(""),
      current_location: normalizeSimpleLocation(""),
      delivery: {
        out_for_delivery: false,
        delivered: false
      },
      events: [{
        status: "Tracking Search Pending",
        description: "Estes page loaded, but shipment details were not returned.",
        location: normalizeSimpleLocation("Estes Express"),
        timestamp: "Carrier update",
        completed: false
      }],
      carrier_tracking_url: finalUrl,
      officialTrackingUrl: finalUrl,
      parsed: {
        pro: tracking,
        status: "Tracking Pending",
        service: "",
        handlingUnits: "",
        shipmentWeight: "",
        packagingType: "",
        billOfLading: "",
        pickupDate: "",
        estimatedDelivery: "",
        travelHistory: []
      },
      source: "Render Estes Express",
      pageText: text.slice(0, 20000),
      debug: {
        title: options.title || "",
        url: finalUrl
      }
    };
  }

  const pro = details.pro || row.pro || tracking;
  const bol = details.bol || row.bol || "";
  const pickupDate = details.pickupDate || row.pickupDate || "";
  const estimatedDelivery = details.estimatedDelivery || row.estimatedDelivery || "";
  const deliveredDate = details.deliveryDate || "";
  let status = cleanEstesTableStatus(details.status || row.status || "Tracking Found");

  if(/delivery completed\s*-\s*ok/i.test(details.deliveryCompletedText || "")){
    status = "Delivered";
  }

  const state = normalizeSimpleState(status);
  const isDelivered = state === "delivered";

  const origin = details.shipperAddress || "";
  const destination = details.consigneeAddress || "";
  const currentLocation = isDelivered ? (destination || "Delivered") : (details.destinationServiceCenterName || "Estes Express");
  const events = details.history.length ? details.history : [];

  if(!events.length && pickupDate){
    events.push({
      status: "We Have Your Shipment",
      description: "Pickup Date",
      location: normalizeSimpleLocation(origin || "Estes Express"),
      timestamp: pickupDate,
      completed: true
    });
  }

  if(isDelivered){
    events.push({
      status: "Delivered",
      description: "Delivery Completed - OK",
      location: normalizeSimpleLocation(destination || "Estes Express"),
      timestamp: deliveredDate || estimatedDelivery || pickupDate || "Carrier update",
      completed: true
    });
  }

  return {
    success: true,
    found: true,
    blocked: false,
    reason: "",
    carrier: "Estes Express",
    tracking: tracking,
    pro: pro,
    status: status,
    state: state,
    statusCopy: isDelivered ? "Delivery Completed - OK" : status,
    service: details.service || "Estes LTL Freight",
    handlingUnits: details.pieces || "",
    pieces: details.pieces || "",
    totalPieces: details.pieces || "",
    shipmentWeight: details.weight || "",
    weight: details.weight || "",
    packagingType: "",
    eta: {
      date: deliveredDate || estimatedDelivery || "",
      time: deliveredDate ? "Estes delivery scan" : estimatedDelivery ? "Estes estimated delivery" : "",
      estimated: !isDelivered
    },
    origin: normalizeSimpleLocation(origin),
    destination: normalizeSimpleLocation(destination),
    current_location: normalizeSimpleLocation(currentLocation),
    delivery: {
      out_for_delivery: state === "out_for_delivery",
      delivered: isDelivered
    },
    events: events,
    carrier_tracking_url: finalUrl,
    officialTrackingUrl: finalUrl,
    parsed: {
      pro: pro,
      status: status,
      service: details.service || "Estes LTL Freight",
      handlingUnits: details.pieces || "",
      pieces: details.pieces || "",
      shipmentWeight: details.weight || "",
      packagingType: "",
      billOfLading: bol,
      pickupDate: pickupDate,
      shipDate: pickupDate,
      estimatedDelivery: estimatedDelivery,
      deliveryDate: deliveredDate,
      transitDays: details.transitDays || "",
      consigneeAddress: destination,
      shipperAddress: origin,
      driverName: details.driverName || "",
      dim: details.dim || "",
      purchaseOrderNumber: details.purchaseOrderNumber || "",
      destinationServiceCenter: {
        name: details.destinationServiceCenterName || "",
        address: details.destinationServiceCenterAddress || "",
        telephone: details.destinationServiceCenterTelephone || "",
        email: details.destinationServiceCenterEmail || ""
      },
      travelHistory: events.map(function(event){
        return {
          status: event.status,
          description: event.description,
          location: event.location.display,
          time: event.timestamp
        };
      })
    },
    billOfLading: bol,
    bol: bol,
    shipDate: pickupDate,
    pickupDate: pickupDate,
    deliveryDate: deliveredDate,
    transitDays: details.transitDays || "",
    driverName: details.driverName || "",
    dim: details.dim || "",
    purchaseOrderNumber: details.purchaseOrderNumber || "",
    destinationServiceCenterName: details.destinationServiceCenterName || "",
    destinationServiceCenterAddress: details.destinationServiceCenterAddress || "",
    destinationServiceCenterTelephone: details.destinationServiceCenterTelephone || "",
    destinationServiceCenterEmail: details.destinationServiceCenterEmail || "",
    source: "Render Estes Express",
    pageText: text.slice(0, 30000),
    debug: {
      title: options.title || "",
      url: finalUrl,
      parsedRow: row,
      expandedDetailsFound: !!details.hasExpandedDetails
    }
  };
}

function parseEstesResultsRow(text, tracking){
  const clean = cleanTextValue(text);
  const result = {
    pro: "",
    pickupDate: "",
    bol: "",
    estimatedDelivery: "",
    status: ""
  };

  const index = clean.indexOf(tracking);
  if(index < 0){
    return result;
  }

  const rowText = clean.slice(index, index + 700).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const statusStop = "(?:Picked Up|In Transit|Out for Delivery|Delivered\\s+Delivery Completed|Delivery Completed|Shipment Details|Shipping|Track|Pickup Visibility|Services|Support|$)";

  const rangeMatch = rowText.match(new RegExp(
    "(\\d{7,12})\\s+" +
    "(\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s+" +
    "(\\d{4,20})\\s+" +
    "(\\d{1,2}\\/\\d{1,2}\\/\\d{4}\\s*[–\\-]\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s+" +
    "([A-Za-z ]+?)\\s*(?=" + statusStop + ")",
    "i"
  ));

  if(rangeMatch){
    result.pro = cleanTextValue(rangeMatch[1]);
    result.pickupDate = cleanTextValue(rangeMatch[2]);
    result.bol = cleanTextValue(rangeMatch[3]);
    result.estimatedDelivery = cleanTextValue(rangeMatch[4]);
    result.status = cleanEstesTableStatus(rangeMatch[5]);
    return result;
  }

  const exactMatch = rowText.match(new RegExp(
    "(\\d{7,12})\\s+" +
    "(\\d{1,2}\\/\\d{1,2}\\/\\d{4})\\s+" +
    "(\\d{4,20})" +
    "(?:\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{4}))?\\s+" +
    "([A-Za-z ]+?)\\s*(?=" + statusStop + ")",
    "i"
  ));

  if(exactMatch){
    result.pro = cleanTextValue(exactMatch[1]);
    result.pickupDate = cleanTextValue(exactMatch[2]);
    result.bol = cleanTextValue(exactMatch[3]);
    result.estimatedDelivery = cleanTextValue(exactMatch[4] || "");
    result.status = cleanEstesTableStatus(exactMatch[5]);
    return result;
  }

  const simple = rowText.match(/(\d{7,12})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{4,20})/i);
  if(simple){
    result.pro = cleanTextValue(simple[1]);
    result.pickupDate = cleanTextValue(simple[2]);
    result.bol = cleanTextValue(simple[3]);

    const afterBol = rowText.slice(rowText.indexOf(simple[3]) + simple[3].length);
    const validStatuses = ["Delivered", "Out for Delivery", "In Transit", "Picked Up", "Appointment Pending", "Appointment Required"];
    for(const status of validStatuses){
      const statusRegex = new RegExp("\\b" + status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      const statusMatch = afterBol.match(statusRegex);
      if(statusMatch){
        const beforeStatus = afterBol.slice(0, statusMatch.index).trim();
        const range = beforeStatus.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s*[–\-]\s*\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/);
        if(range){
          result.estimatedDelivery = cleanTextValue(range[1]);
        }
        result.status = status;
        break;
      }
    }
  }

  return result;
}

function cleanEstesTableStatus(value){
  let text = cleanTextValue(value);
  text = text.replace(/\bPicked Up\b.*$/i, "").trim();
  text = text.replace(/\bIn Transit\b.*$/i, "").trim();
  text = text.replace(/\bOut for Delivery\b.*$/i, "").trim();
  text = text.replace(/\bDelivered Delivery Completed.*$/i, "Delivered").trim();
  text = text.replace(/\bShipment Details\b.*$/i, "").trim();

  if(/^delivered$/i.test(text)) return "Delivered";
  if(/^out for delivery$/i.test(text)) return "Out for Delivery";
  if(/^in transit$/i.test(text)) return "In Transit";
  if(/^picked up$/i.test(text)) return "Picked Up";

  return text;
}



function cleanEstesDateTime(value){
  const text = cleanTextValue(value);
  const match = text.match(/\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/i);
  return match ? cleanTextValue(match[0]) : text;
}


function parseEstesExpandedDetails(text, tracking){
  const clean = String(text || "").replace(/\u00a0/g, " ");
  const flat = clean.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const result = {
    hasExpandedDetails: /Shipment Details|Shipment History|Delivery Details|Reference Numbers|Destination Service Center/i.test(clean),
    pro: tracking,
    status: "",
    shipperAddress: "",
    pickupDate: "",
    pieces: "",
    weight: "",
    transitDays: "",
    consigneeAddress: "",
    appointmentDate: "",
    appointmentStatus: "",
    deliveryDate: "",
    driverName: "",
    bol: "",
    dim: "",
    purchaseOrderNumber: "",
    destinationServiceCenterName: "",
    destinationServiceCenterAddress: "",
    destinationServiceCenterTelephone: "",
    destinationServiceCenterEmail: "",
    estimatedDelivery: "",
    service: "Estes LTL Freight",
    history: []
  };

  function val(label, endLabels){
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const end = endLabels && endLabels.length ? endLabels.map(function(item){
      return item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("|") : "Pickup Date|Pieces|Weight|Transit Days|Delivery Details|Reference Numbers|Destination Service Center|Shipment History|$";
    const pattern = new RegExp(escaped + "\\s+(.+?)(?=\\s+(?:" + end + ")\\s+|$)", "i");
    const match = flat.match(pattern);
    return match && match[1] ? cleanTextValue(match[1]) : "";
  }

  result.shipperAddress = cleanEstesAddress(val("Shipper Address", ["Pickup Date"]));
  result.pickupDate = cleanEstesDateTime(val("Pickup Date", ["Pieces"]));
  result.pieces = val("Pieces", ["Weight"]);
  result.weight = val("Weight (lbs.)", ["Transit Days"]);
  result.transitDays = val("Transit Days", ["Shipment History", "Delivery Details"]);
  result.consigneeAddress = cleanEstesAddress(val("Consignee Address", ["Estimated Delivery Date", "Appointment Date", "Delivery Date", "Driver Name", "Reference Numbers"]));
  result.estimatedDelivery = cleanEstesDateRange(val("Estimated Delivery Date", ["Appointment Date", "Delivery Date", "Driver Name", "Reference Numbers"]));
  result.appointmentDate = cleanEstesDateTime(val("Appointment Date", ["Appointment Status"]));
  result.appointmentStatus = cleanTextValue(val("Appointment Status", ["Delivery Date", "Driver Name", "Reference Numbers"]));
  result.deliveryDate = cleanEstesDateTime(val("Delivery Date", ["Driver Name"]));
  result.driverName = val("Driver Name", ["Reference Numbers"]);
  result.bol = val("Shipper Bill of Lading Number", ["DIM"]);
  result.dim = val("DIM", ["Purchase Order Number"]);
  result.purchaseOrderNumber = val("Purchase Order Number", ["Destination Service Center"]);
  const serviceCenter = parseEstesServiceCenter(clean);
  result.destinationServiceCenterName = serviceCenter.name || val("Name", ["Address"]);
  result.destinationServiceCenterAddress = serviceCenter.address || val("Address", ["Telephone"]);
  result.destinationServiceCenterTelephone = serviceCenter.telephone || val("Telephone", ["Email"]);
  result.destinationServiceCenterEmail = serviceCenter.email || val("Email", ["Shipping", "Track", "Pickup Visibility", "Services", "Support", "$"]);

  result.shipperAddress = cleanEstesAddress(result.shipperAddress);
  result.consigneeAddress = cleanEstesAddress(result.consigneeAddress);
  result.destinationServiceCenterName = cleanEstesServiceCenterName(result.destinationServiceCenterName);
  result.destinationServiceCenterAddress = cleanEstesAddress(result.destinationServiceCenterAddress);
  result.destinationServiceCenterEmail = result.destinationServiceCenterEmail.replace(/\s+Additional Information.*$/i, "").trim();

  const row = parseEstesResultsRow(text, tracking);
  if(row.bol && !result.bol) result.bol = row.bol;
  if(row.pickupDate && !result.pickupDate) result.pickupDate = row.pickupDate;
  if(row.estimatedDelivery && !result.estimatedDelivery) result.estimatedDelivery = row.estimatedDelivery;
  if(row.status && !result.status) result.status = row.status;

  result.deliveryCompletedText = "";
  if(/Delivery Completed\s*-\s*OK/i.test(flat)){
    result.deliveryCompletedText = "Delivery Completed - OK";
  }

  result.history = parseEstesShipmentHistory(clean);

  return result;
}



function cleanEstesAddress(value){
  let text = cleanTextValue(value);
  text = text.replace(/\s+Estimated Delivery Date\s+.*$/i, "");
  text = text.replace(/\s+Appointment Date\s+.*$/i, "");
  text = text.replace(/\s+Appointment Status\s+.*$/i, "");
  text = text.replace(/\s+Delivery Date\s+.*$/i, "");
  text = text.replace(/\s+Driver Name\s+.*$/i, "");
  text = text.replace(/\s+Reference Numbers\s+.*$/i, "");
  text = text.replace(/\s+Destination Service Center\s+.*$/i, "");
  text = text.replace(/\s+Telephone\s+.*$/i, "");
  text = text.replace(/\s+Email\s+.*$/i, "");
  text = text.replace(/\s+Additional Information\s+.*$/i, "");
  text = text.replace(/\s+Shipping\s+Track\s+.*$/i, "");
  return cleanTextValue(text);
}

function cleanEstesDateRange(value){
  const text = cleanTextValue(value);
  const range = text.match(/\d{1,2}\/\d{1,2}\/\d{4}\s*[–-]\s*\d{1,2}\/\d{1,2}\/\d{4}/);
  if(range) return cleanTextValue(range[0]);

  const single = text.match(/\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?/i);
  return single ? cleanTextValue(single[0]) : text;
}

function cleanEstesServiceCenterName(value){
  let text = cleanTextValue(value);
  text = text.replace(/^Destination Service Center\s*/i, "");
  text = text.replace(/^Name\s*/i, "");
  text = text.replace(/\s+Address\s+.*$/i, "");
  text = text.replace(/\s+Telephone\s+.*$/i, "");
  text = text.replace(/\s+Email\s+.*$/i, "");
  return cleanTextValue(text);
}

function parseEstesServiceCenter(text){
  const result = {
    name: "",
    address: "",
    telephone: "",
    email: ""
  };

  const start = String(text || "").search(/Destination Service Center/i);
  if(start < 0) return result;

  let chunk = String(text || "").slice(start, start + 1500);
  const end = chunk.search(/Additional Information|Questions\?|Need a delivery receipt|Shipping\s+Track|Pickup Visibility|Services\s+Support/i);
  if(end > 0){
    chunk = chunk.slice(0, end);
  }

  const lines = chunk.split(/\n+/).map(function(line){
    return cleanTextValue(line);
  }).filter(Boolean);

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    if(/^Name\b/i.test(line)){
      result.name = cleanTextValue(line.replace(/^Name\s*/i, ""));
      if(!result.name && lines[i + 1]) result.name = cleanTextValue(lines[i + 1]);
    }

    if(/^Address\b/i.test(line)){
      result.address = cleanTextValue(line.replace(/^Address\s*/i, ""));
      if(!result.address && lines[i + 1]) result.address = cleanTextValue(lines[i + 1]);
    }

    if(/^Telephone\b/i.test(line)){
      result.telephone = cleanTextValue(line.replace(/^Telephone\s*/i, ""));
      if(!result.telephone && lines[i + 1]) result.telephone = cleanTextValue(lines[i + 1]);
    }

    if(/^Email\b/i.test(line)){
      result.email = cleanTextValue(line.replace(/^Email\s*/i, ""));
      if(!result.email && lines[i + 1]) result.email = cleanTextValue(lines[i + 1]);
    }
  }

  result.name = cleanEstesServiceCenterName(result.name);
  result.address = cleanEstesAddress(result.address);
  result.email = result.email.replace(/\s+Additional Information.*$/i, "").trim();

  return result;
}


function parseEstesShipmentHistory(text){
  const events = [];
  const clean = String(text || "").replace(/\u00a0/g, " ");
  const start = clean.search(/Shipment History/i);
  if(start < 0) return events;

  let end = clean.search(/Delivery Details/i);
  if(end < start) end = clean.search(/Reference Numbers/i);
  if(end < start) end = clean.length;

  const chunk = clean.slice(start, end);
  const lines = chunk.split(/\n+/).map(function(line){
    return cleanTextValue(line);
  }).filter(Boolean);

  let activeDate = "";

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)){
      activeDate = line;
      continue;
    }

    if(/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)$/i.test(line)){
      activeDate = line.split(/\s+/)[0];
      continue;
    }

    const next = lines[i + 1] || "";
    const timeMatch = next.match(/^(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(AM|PM)|\d{1,2}:\d{2}\s*(AM|PM))$/i);

    if(timeMatch){
      const status = line;
      const timestamp = next.indexOf("/") >= 0 ? next : activeDate ? activeDate + " " + next : next;

      if(!/see more history|shipment history/i.test(status)){
        events.push({
          status: normalizeEstesHistoryStatus(status),
          description: status,
          location: normalizeSimpleLocation("Estes Express"),
          timestamp: timestamp,
          completed: true
        });
      }

      i++;
    }
  }

  if(!events.length){
    const flat = chunk.replace(/\n+/g, " ").replace(/\s+/g, " ");
    const regex = /(Delivery Completed\s*-\s*OK|Delivery in Progress\s*–?\s*Freight Given to Consignee for Unloading|Unload at Delivery Location|Arrived at Delivery Location|Out for Delivery)\s+(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/gi;
    let match;
    while((match = regex.exec(flat)) !== null){
      events.push({
        status: normalizeEstesHistoryStatus(match[1]),
        description: cleanTextValue(match[1]),
        location: normalizeSimpleLocation("Estes Express"),
        timestamp: cleanTextValue(match[2]),
        completed: true
      });
    }
  }

  return events;
}

function normalizeEstesHistoryStatus(value){
  const text = cleanTextValue(value);
  const lower = text.toLowerCase();

  if(lower.indexOf("delivery completed") >= 0) return "Delivered";
  if(lower.indexOf("delivery in progress") >= 0) return "Delivery In Progress";
  if(lower.indexOf("unload") >= 0) return "Unload At Delivery Location";
  if(lower.indexOf("arrived") >= 0) return "Arrived At Delivery Location";
  if(lower.indexOf("out for delivery") >= 0) return "Out For Delivery";

  return text || "Carrier Update";
}


app.post("/track-estes", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeEstesTracking(tracking), 75000, "Estes Express tracking");
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

  const result = await withTimeout(scrapeEstesTracking(tracking), 75000, "Estes Express tracking");
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


async function scrapeTForceTracking(tracking){
  tracking = cleanTracking(tracking);
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

    const directUrl = "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking);

    await page.goto(directUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await clickPossibleCookieButtons(page);
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(function(){});
    await page.waitForTimeout(8000);

    let report = await getPageReport(page);
    let bodyText = report && report.bodyText ? report.bodyText : "";
    let finalUrl = page.url();

    if(!tforcePageHasResult(bodyText, tracking)){
      const filled = await setInputValue(page, [
        "input[placeholder*='PRO']",
        "input[placeholder*='pro']",
        "input[placeholder*='Tracking']",
        "input[placeholder*='tracking']",
        "input[aria-label*='PRO']",
        "input[aria-label*='Tracking']",
        "input[name*='pro']",
        "input[id*='pro']",
        "input[type='search']",
        "input[type='text']",
        "textarea",
        "input"
      ], tracking);

      await page.waitForTimeout(1500);

      const clicked = await clickBySelectors(page, [
        "button:has-text('Track')",
        "button:has-text('TRACK')",
        "button:has-text('Search')",
        "button:has-text('Submit')",
        "input[type='submit']",
        "[role='button']:has-text('Track')",
        "[role='button']:has-text('Search')",
        "button"
      ]);

      if(!clicked.success){
        await page.keyboard.press("Enter").catch(function(){});
      }

      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(function(){});
      await page.waitForTimeout(12000);

      report = await getPageReport(page);
      bodyText = report && report.bodyText ? report.bodyText : "";
      finalUrl = page.url();
    }

    await browser.close();

    return buildTForceCarrierResponse({
      carrierName: "TForce Freight",
      tracking: tracking,
      bodyText: bodyText,
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
      carrier: "TForce Freight",
      tracking: tracking,
      error: error.message,
      reason: "SCRAPE_ERROR",
      finalUrl: "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking),
      events: []
    };
  }
}

function tforcePageHasResult(text, tracking){
  const body = String(text || "").toLowerCase();
  const cleanPro = String(tracking || "").toLowerCase();

  if(body.indexOf(cleanPro) < 0) return false;

  return body.indexOf("delivered") >= 0 ||
    body.indexOf("in transit") >= 0 ||
    body.indexOf("out for delivery") >= 0 ||
    body.indexOf("pickup") >= 0 ||
    body.indexOf("shipment") >= 0 ||
    body.indexOf("pro number") >= 0 ||
    body.indexOf("consignee") >= 0 ||
    body.indexOf("shipper") >= 0;
}

function buildTForceCarrierResponse(options){
  const text = cleanTextValue(options.bodyText || "");
  const lines = compactTrackingLines(text);
  const tracking = cleanTracking(options.tracking);
  const finalUrl = options.finalUrl || "https://www.tforcefreight.com/ltl/apps/Tracking?proNumbers=" + encodeURIComponent(tracking);
  const lower = text.toLowerCase();

  const blocked = lower.indexOf("captcha") >= 0 ||
    lower.indexOf("verify you are human") >= 0 ||
    lower.indexOf("access denied") >= 0 ||
    lower.indexOf("forbidden") >= 0;

  const notFound = lower.indexOf("not found") >= 0 ||
    lower.indexOf("no shipment") >= 0 ||
    lower.indexOf("unable to locate") >= 0 ||
    lower.indexOf("no records") >= 0 ||
    lower.indexOf("no results") >= 0;

  const row = parseTForceText(text, tracking);
  const status = row.status || (notFound ? "Not Found" : "Tracking Found");
  const state = normalizeSimpleState(status);
  const events = row.events.length ? row.events : [{
    status: status,
    description: status,
    location: normalizeSimpleLocation(row.currentLocation || "TForce Freight"),
    timestamp: row.deliveryDate || row.pickupDate || "Carrier update",
    completed: state !== "tracking_pending" && state !== "not_found"
  }];

  return {
    success: !blocked && !notFound && tforcePageHasResult(text, tracking),
    found: !blocked && !notFound && tforcePageHasResult(text, tracking),
    blocked: blocked,
    reason: blocked ? "CAPTCHA_OR_ACCESS_BLOCK" : notFound ? "NOT_FOUND" : tforcePageHasResult(text, tracking) ? "" : "TFORCE_DETAILS_NOT_RETURNED",
    carrier: "TForce Freight",
    tracking: tracking,
    pro: row.pro || tracking,
    status: status,
    state: state,
    statusCopy: status,
    service: row.service || "TForce Freight",
    handlingUnits: row.pieces || row.handlingUnits || "",
    pieces: row.pieces || "",
    totalPieces: row.pieces || "",
    shipmentWeight: row.weight || "",
    weight: row.weight || "",
    packagingType: row.packaging || "",
    eta: {
      date: row.deliveryDate || row.estimatedDelivery || "",
      time: row.deliveryDate ? "TForce delivery scan" : row.estimatedDelivery ? "TForce estimated delivery" : "",
      estimated: state !== "delivered"
    },
    origin: normalizeSimpleLocation(row.origin || ""),
    destination: normalizeSimpleLocation(row.destination || ""),
    current_location: normalizeSimpleLocation(row.currentLocation || row.destination || row.origin || ""),
    delivery: {
      out_for_delivery: state === "out_for_delivery",
      delivered: state === "delivered"
    },
    events: events,
    carrier_tracking_url: finalUrl,
    officialTrackingUrl: finalUrl,
    parsed: {
      pro: row.pro || tracking,
      status: status,
      service: row.service || "TForce Freight",
      handlingUnits: row.handlingUnits || row.pieces || "",
      pieces: row.pieces || "",
      shipmentWeight: row.weight || "",
      packagingType: row.packaging || "",
      billOfLading: row.bol || "",
      pickupDate: row.pickupDate || "",
      estimatedDelivery: row.estimatedDelivery || "",
      deliveryDate: row.deliveryDate || "",
      origin: row.origin || "",
      destination: row.destination || "",
      travelHistory: events.map(function(event){
        return {
          status: event.status,
          description: event.description,
          location: event.location.display,
          time: event.timestamp
        };
      })
    },
    billOfLading: row.bol || "",
    bol: row.bol || "",
    shipDate: row.pickupDate || "",
    source: "Render TForce Freight",
    pageText: text.slice(0, 30000),
    debug: {
      title: options.title || "",
      url: finalUrl,
      parsedRow: row
    }
  };
}

function parseTForceText(text, tracking){
  const flat = cleanTextValue(String(text || "").replace(/\n+/g, " "));
  const lines = compactTrackingLines(text);
  const result = {
    pro: tracking,
    status: "",
    service: "",
    pieces: "",
    handlingUnits: "",
    weight: "",
    packaging: "",
    bol: "",
    pickupDate: "",
    estimatedDelivery: "",
    deliveryDate: "",
    origin: "",
    destination: "",
    currentLocation: "",
    events: []
  };

  result.status = firstMatch(flat, [
    /Status\s*:?\s*([A-Za-z ]+?)(?=\s+(?:PRO|Pickup|Delivery|Origin|Destination|Shipper|Consignee|Weight|Pieces|BOL|Reference|Service)|$)/i,
    /Shipment Status\s*:?\s*([A-Za-z ]+?)(?=\s+(?:PRO|Pickup|Delivery|Origin|Destination|Shipper|Consignee|Weight|Pieces|BOL|Reference|Service)|$)/i,
    /\b(Delivered|Out for Delivery|In Transit|Picked Up|Pickup|Appointment Pending|Exception)\b/i
  ]);

  result.pro = firstMatch(flat, [
    /PRO\s*(?:Number|#)?\s*:?\s*(\d{7,12})/i,
    /Tracking\s*(?:Number|#)?\s*:?\s*(\d{7,12})/i
  ]) || tracking;

  result.pickupDate = firstMatch(flat, [
    /Pickup\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /Ship\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.estimatedDelivery = firstMatch(flat, [
    /Estimated\s*Delivery\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /ETA\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.deliveryDate = firstMatch(flat, [
    /Delivery\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /Delivered\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.origin = cleanTForceLocation(firstMatch(flat, [
    /Origin\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i,
    /Shipper\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i
  ]));

  result.destination = cleanTForceLocation(firstMatch(flat, [
    /Destination\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i,
    /Consignee\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i
  ]));

  result.currentLocation = cleanTForceLocation(firstMatch(flat, [
    /Current\s*Location\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i,
    /Location\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i
  ]));

  result.pieces = firstMatch(flat, [
    /Pieces\s*:?\s*([0-9,]+)/i,
    /Total\s*Pieces\s*:?\s*([0-9,]+)/i,
    /Handling\s*Units\s*:?\s*([0-9,]+)/i
  ]);

  result.handlingUnits = firstMatch(flat, [
    /Handling\s*Units\s*:?\s*([0-9,]+)/i
  ]) || result.pieces;

  result.weight = firstMatch(flat, [
    /Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /Shipment\s*Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i
  ]);

  result.bol = firstMatch(flat, [
    /BOL\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i,
    /Bill\s*of\s*Lading\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i
  ]);

  result.service = firstMatch(flat, [
    /Service\s*:?\s*([A-Za-z0-9 \-/]+?)(?=\s+(?:Status|PRO|Pickup|Delivery|Origin|Destination|Weight|Pieces|BOL)|$)/i
  ]);

  result.events = parseTForceEvents(lines, result);

  return result;
}

function parseTForceEvents(lines, result){
  const events = [];
  const eventWords = [
    "Delivered",
    "Out for Delivery",
    "In Transit",
    "Picked Up",
    "Pickup",
    "Arrived",
    "Departed",
    "Exception",
    "Appointment"
  ];

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];
    const found = eventWords.find(function(word){
      return line.toLowerCase().indexOf(word.toLowerCase()) >= 0;
    });

    if(!found) continue;

    const windowLines = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 6));
    const windowText = windowLines.join(" ");
    const time = firstMatch(windowText, [
      /(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/i
    ]);
    const location = cleanTForceLocation(windowLines.find(function(item){
      return /^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?$/i.test(item);
    }) || result.currentLocation || result.destination || result.origin || "TForce Freight");

    events.push({
      status: normalizeTForceStatus(found),
      description: line,
      location: normalizeSimpleLocation(location),
      timestamp: time || "Carrier update",
      completed: true
    });
  }

  return events;
}

function normalizeTForceStatus(value){
  const lower = String(value || "").toLowerCase();

  if(lower.indexOf("delivered") >= 0) return "Delivered";
  if(lower.indexOf("out for delivery") >= 0) return "Out For Delivery";
  if(lower.indexOf("transit") >= 0) return "In Transit";
  if(lower.indexOf("picked") >= 0 || lower.indexOf("pickup") >= 0) return "Picked Up";
  if(lower.indexOf("arrived") >= 0) return "Arrived";
  if(lower.indexOf("departed") >= 0) return "Departed";
  if(lower.indexOf("appointment") >= 0) return "Appointment";
  if(lower.indexOf("exception") >= 0) return "Exception";

  return cleanTextValue(value || "Carrier Update");
}

function cleanTForceLocation(value){
  let text = cleanTextValue(value);
  text = text.replace(/\s+Status\s+.*$/i, "");
  text = text.replace(/\s+Pickup\s+.*$/i, "");
  text = text.replace(/\s+Delivery\s+.*$/i, "");
  text = text.replace(/\s+Weight\s+.*$/i, "");
  text = text.replace(/\s+Pieces\s+.*$/i, "");
  text = text.replace(/\s+BOL\s+.*$/i, "");
  return text;
}


app.post("/track-tforce", async function(req, res){
  const tracking = cleanTracking(req.body.tracking || req.query.tracking || req.body.pro || req.query.pro);

  if(!tracking){
    return res.status(400).json({
      success: false,
      error: "Tracking number required"
    });
  }

  const result = await withTimeout(scrapeTForceTracking(tracking), 65000, "TForce Freight tracking");
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

  const result = await withTimeout(scrapeTForceTracking(tracking), 65000, "TForce Freight tracking");
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
    const result = await withTimeout(scrapeEstesTracking(tracking), 75000, "Estes Express tracking");
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
    const result = await withTimeout(scrapeTForceTracking(tracking), 65000, "TForce Freight tracking");
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
