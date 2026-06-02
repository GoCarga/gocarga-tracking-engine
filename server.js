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
    version: "2.14",
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

app.use(requireRenderAccessForTrackingRoutes);

function requireRenderAccessForTrackingRoutes(req, res, next){
  const protectedRoutes = [
    "/track",
    "/track-fedex",
    "/track-estes",
    "/track-abf",
    "/track-dayton",
    "/track-tforce",
    "/track-aaa",
    "/debug-aaa"
  ];

  const routePath = String(req.path || "");
  const shouldProtect = protectedRoutes.some(function(route){
    return routePath === route || routePath.indexOf(route + "/") === 0;
  });

  if(!shouldProtect){
    return next();
  }

  const requiredKey = String(process.env.GOCARGA_TRACKING_KEY || "").trim();

  if(!requiredKey){
    return next();
  }

  const providedKey = String(
    req.headers["x-gocarga-tracking-key"] ||
    req.headers["x-api-key"] ||
    req.query.key ||
    ""
  ).trim();

  if(providedKey && providedKey === requiredKey){
    return next();
  }

  return res.status(401).json({
    success: false,
    found: false,
    reason: "UNAUTHORIZED_TRACKING_REQUEST",
    message: "Tracking request is not authorized."
  });
}


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
          time: event.timestamp,
          trailer: event.trailer || ""
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




function estesBodyHasRealResult(text, tracking){
  const body = String(text || "");
  const lower = body.toLowerCase();
  const pro = String(tracking || "").toLowerCase();

  if(!body || body.length < 50) return false;
  if(lower.indexOf("not found or tracking information unavailable") >= 0) return true;
  if(pro && lower.indexOf(pro) >= 0 && (lower.indexOf("tracking results") >= 0 || lower.indexOf("shipment details") >= 0 || lower.indexOf("shipment history") >= 0 || lower.indexOf("delivery details") >= 0 || lower.indexOf("reference numbers") >= 0)) return true;
  if(lower.indexOf("shipment details") >= 0 && lower.indexOf("shipment history") >= 0) return true;

  return false;
}

async function readEstesBodyText(page){
  let text = "";

  try{
    text = await page.locator("body").innerText({ timeout: 5000 });
  } catch(error){}

  if(!text || cleanTextValue(text).length < 50){
    try{
      text = await page.evaluate(function(){
        return document.body ? document.body.innerText || document.body.textContent || "" : "";
      });
    } catch(error){}
  }

  return cleanTextValue(text);
}

async function waitForEstesResultText(page, tracking, timeoutMs){
  const started = Date.now();
  let lastText = "";

  while(Date.now() - started < timeoutMs){
    lastText = await readEstesBodyText(page);

    if(estesBodyHasRealResult(lastText, tracking)){
      return {
        found: true,
        text: lastText
      };
    }

    await page.waitForTimeout(1200).catch(function(){});
  }

  return {
    found: false,
    text: lastText
  };
}

async function clickEstesResultExpanders(page, tracking){
  const clicked = [];

  try{
    const ariaItems = await page.locator("[aria-expanded='false']").all();
    for(const item of ariaItems.slice(0, 8)){
      try{
        if(await item.isVisible({ timeout: 700 })){
          await item.click({ force: true, timeout: 1800 }).catch(async function(){
            await item.evaluate(function(el){ el.click(); }).catch(function(){});
          });
          clicked.push("aria-expanded");
          await page.waitForTimeout(900);
        }
      } catch(error){}
    }
  } catch(error){}

  const selectors = [
    "button:has-text('Expand All')",
    "a:has-text('Expand All')",
    "[role='button']:has-text('Expand All')",
    "button:has-text('Shipment Details')",
    "button:has-text('Details')",
    "button:has-text('Expand')",
    "[aria-label*='Expand']",
    "button[aria-label*='Expand']"
  ];

  for(const selector of selectors){
    try{
      const items = await page.locator(selector).all();
      for(const item of items.slice(0, 6)){
        try{
          if(await item.isVisible({ timeout: 700 })){
            await item.click({ force: true, timeout: 1800 }).catch(async function(){
              await item.evaluate(function(el){ el.click(); }).catch(function(){});
            });
            clicked.push(selector);
            await page.waitForTimeout(900);
          }
        } catch(error){}
      }
    } catch(error){}
  }

  try{
    const clickedByEval = await page.evaluate(function(pro){
      const textOf = function(el){
        return (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
      };

      let total = 0;
      const all = Array.from(document.querySelectorAll("button, a, [role='button'], [aria-expanded], tr, .accordion, .accordion-item, .card"));

      all.forEach(function(el){
        const txt = textOf(el);
        const aria = el.getAttribute("aria-expanded") || "";
        const likely = /expand|details|shipment|history|reference|delivery/i.test(txt) || aria === "false" || (pro && txt.indexOf(pro) >= 0);

        if(likely){
          try{
            el.click();
            total += 1;
          } catch(error){}
        }
      });

      return total;
    }, tracking);

    if(clickedByEval){
      clicked.push("evaluate:" + clickedByEval);
      await page.waitForTimeout(2200);
    }
  } catch(error){}

  return clicked;
}

async function submitEstesForm(page, tracking){
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
    return {
      filled: filled,
      clicked: { success: false }
    };
  }

  await page.waitForTimeout(800);

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

  return {
    filled: filled,
    clicked: clicked
  };
}

async function scrapeEstesTracking(tracking){
  tracking = cleanTracking(tracking);
  let browser;

  const directUrl = "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO";
  const startUrl = "https://www.estes-express.com/myestes/shipment-tracking/";

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

    let report = null;
    let bodyText = "";
    let finalUrl = directUrl;
    let expandClicks = [];
    let searchMode = "direct-query";

    await page.goto(directUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });

    await clickPossibleCookieButtons(page);

    let waitResult = await waitForEstesResultText(page, tracking, 26000);
    bodyText = waitResult.text || "";

    if(!waitResult.found){
      searchMode = "form-submit-fallback";

      await page.goto(startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      }).catch(function(){});

      await clickPossibleCookieButtons(page);
      await page.waitForTimeout(1200);
      await submitEstesForm(page, tracking);
      waitResult = await waitForEstesResultText(page, tracking, 26000);
      bodyText = waitResult.text || bodyText || "";
    }

    if(estesBodyHasRealResult(bodyText, tracking)){
      expandClicks = await clickEstesResultExpanders(page, tracking);
      await page.waitForTimeout(1800);
      bodyText = await readEstesBodyText(page);
    }

    report = await getPageReport(page);
    finalUrl = page.url();

    if(report && report.bodyText && cleanTextValue(report.bodyText).length > cleanTextValue(bodyText).length){
      bodyText = report.bodyText;
    }

    await browser.close();

    const response = buildEstesCarrierResponse({
      carrierName: "Estes Express",
      tracking: tracking,
      bodyText: bodyText || "",
      finalUrl: finalUrl,
      title: report && report.title ? report.title : ""
    });

    response.debug = response.debug || {};
    response.debug.searchMode = searchMode;
    response.debug.expandClicks = expandClicks;
    response.debug.bodyLength = cleanTextValue(bodyText).length;

    return response;

  } catch(error){
    if(browser){
      await browser.close().catch(function(){});
    }

    return {
      success: false,
      found: false,
      carrier: "Estes Express",
      tracking: tracking,
      pro: tracking,
      error: error.message,
      reason: "SCRAPE_ERROR",
      status: "Tracking Pending",
      state: "tracking_pending",
      statusCopy: "Estes tracking did not return shipment details.",
      finalUrl: directUrl,
      carrier_tracking_url: directUrl,
      officialTrackingUrl: directUrl,
      events: [],
      parsed: {
        pro: tracking,
        status: "Tracking Pending",
        travelHistory: []
      },
      debug: {
        title: "Estes Scrape Error",
        url: directUrl
      }
    };
  }
}

function buildEstesCarrierResponse(options){
  const text = cleanTextValue(options.bodyText || "");
  const tracking = cleanTracking(options.tracking);
  const finalUrl = options.finalUrl || "https://www.estes-express.com/myestes/shipment-tracking/?query=" + encodeURIComponent(tracking) + "&type=PRO";
  const lowerText = text.toLowerCase();
  const notFound = lowerText.indexOf("not found or tracking information unavailable") >= 0 ||
    lowerText.indexOf("no shipments found") >= 0 ||
    lowerText.indexOf("unable to locate") >= 0;
  const cookieOnly = text.indexOf("Shipment Tracking") >= 0 &&
    text.indexOf("Enter tracking numbers") >= 0 &&
    text.indexOf("Tracking Results") < 0 &&
    !notFound;

  const row = parseEstesResultsRow(text, tracking);
  const details = parseEstesExpandedDetails(text, tracking);
  const hasConcreteResults = !!row.pro ||
    !!row.bol ||
    !!row.status ||
    !!details.bol ||
    !!details.pickupDate ||
    !!details.pieces ||
    !!details.weight ||
    !!details.shipperAddress ||
    !!details.consigneeAddress ||
    !!details.deliveryDate ||
    (Array.isArray(details.history) && details.history.length > 0);

  if(notFound || cookieOnly || !hasConcreteResults){
    const reason = notFound ? "ESTES_NOT_FOUND" : cookieOnly ? "ESTES_SEARCH_NOT_SUBMITTED" : "ESTES_DETAILS_NOT_RETURNED";
    const copy = notFound ? "Estes returned not found for this PRO." : "Estes page loaded, but shipment details were not returned.";

    return {
      success: false,
      found: false,
      blocked: false,
      reason: reason,
      carrier: "Estes Express",
      tracking: tracking,
      pro: tracking,
      status: notFound ? "Not Found" : "Tracking Pending",
      state: notFound ? "not_found" : "tracking_pending",
      statusCopy: copy,
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
        status: notFound ? "Not Found" : "Tracking Search Pending",
        description: copy,
        location: normalizeSimpleLocation("Estes Express"),
        timestamp: "Carrier update",
        completed: false
      }],
      carrier_tracking_url: finalUrl,
      officialTrackingUrl: finalUrl,
      parsed: {
        pro: tracking,
        status: notFound ? "Not Found" : "Tracking Pending",
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
      pageText: text.slice(0, 30000),
      debug: {
        title: options.title || "",
        url: finalUrl,
        bodyLength: text.length,
        row: row,
        detailsFound: !!details.hasExpandedDetails
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
          time: event.timestamp,
          trailer: event.trailer || ""
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

  const result = await withTimeout(scrapeEstesTracking(tracking), 70000, "Estes Express tracking");
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

  const result = await withTimeout(scrapeEstesTracking(tracking), 70000, "Estes Express tracking");
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



async function readReliableBodyText(page){
  let text = "";

  try {
    text = await page.locator("body").innerText({ timeout: 8000 });
  } catch(error){}

  if(!text || cleanTextValue(text).length < 50){
    try {
      text = await page.evaluate(function(){
        return document.body ? document.body.innerText || document.body.textContent || "" : "";
      });
    } catch(error){}
  }

  return cleanTextValue(text);
}

async function waitForTForceResults(page, tracking){
  const expected = "PRO(S) RELATED TO " + tracking;

  try {
    await page.waitForFunction(function(expectedText){
      return document.body && document.body.innerText && document.body.innerText.indexOf(expectedText) >= 0;
    }, expected, { timeout: 35000 });
    return true;
  } catch(error){}

  try {
    await page.waitForFunction(function(pro){
      const text = document.body && document.body.innerText ? document.body.innerText : "";
      return text.indexOf(pro) >= 0 && (
        text.indexOf("Delivered On") >= 0 ||
        text.indexOf("Ship To") >= 0 ||
        text.indexOf("Ship From") >= 0 ||
        text.indexOf("Signed By") >= 0
      );
    }, tracking, { timeout: 15000 });
    return true;
  } catch(error){}

  return false;
}


async function expandTForceDetails(page){
  const selectors = [
    "button:has-text('Show Details')",
    "a:has-text('Show Details')",
    "[role='button']:has-text('Show Details')",
    "button:has-text('Details')",
    "a:has-text('Details')",
    "[aria-label*='Show Details']",
    "[aria-label*='Details']",
    "button"
  ];

  for(const selector of selectors){
    try{
      const items = await page.locator(selector).all();

      for(const item of items.slice(0, 12)){
        try{
          const text = cleanTextValue(await item.innerText({ timeout: 500 }).catch(function(){ return ""; }));
          const label = await item.getAttribute("aria-label").catch(function(){ return ""; });
          const combined = (text + " " + (label || "")).trim();

          if(/show details|details|\+/i.test(combined)){
            if(await item.isVisible({ timeout: 800 })){
              await item.click({ force: true, timeout: 2500 }).catch(async function(){
                await item.evaluate(function(el){ el.click(); }).catch(function(){});
              });
              await page.waitForTimeout(3500);
              return true;
            }
          }
        } catch(error){}
      }
    } catch(error){}
  }

  try{
    const clicked = await page.evaluate(function(){
      const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], div, span"));
      const item = candidates.find(function(el){
        const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim();
        return /show details|details \+|show details \+/i.test(text);
      });

      if(item){
        item.click();
        return true;
      }

      return false;
    });

    if(clicked){
      await page.waitForTimeout(3500);
      return true;
    }
  } catch(error){}

  return false;
}

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
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(function(){});
    await waitForTForceResults(page, tracking);
    await page.waitForTimeout(2000);
    await expandTForceDetails(page);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(function(){});
    await page.waitForTimeout(3000);

    let report = await getPageReport(page);
    let bodyText = report && report.bodyText ? report.bodyText : "";
    bodyText = bodyText && cleanTextValue(bodyText).length > 50 ? bodyText : await readReliableBodyText(page);
    let finalUrl = page.url();

    if(!tforcePageHasResult(bodyText, tracking)){
      await setInputValue(page, [
        "textarea",
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

      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(function(){});
      await waitForTForceResults(page, tracking);
      await page.waitForTimeout(2000);
      await expandTForceDetails(page);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(function(){});
      await page.waitForTimeout(4000);

      report = await getPageReport(page);
      bodyText = report && report.bodyText ? report.bodyText : "";
      bodyText = bodyText && cleanTextValue(bodyText).length > 50 ? bodyText : await readReliableBodyText(page);
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

  if(!body || body.indexOf(cleanPro) < 0) return false;

  return body.indexOf("pro(s) related to") >= 0 ||
    body.indexOf("delivered on") >= 0 ||
    body.indexOf("signed by") >= 0 ||
    body.indexOf("ship to") >= 0 ||
    body.indexOf("ship from") >= 0 ||
    body.indexOf("shipment has been delivered") >= 0 ||
    body.indexOf("tracking results provided by tforce") >= 0;
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
  const hasParsedTForceDetails = !!(row.status && (row.deliveryDate || row.signedBy || row.origin || row.destination));
  const events = row.events.length ? row.events : [{
    status: status,
    description: status,
    location: normalizeSimpleLocation(row.currentLocation || "TForce Freight"),
    timestamp: row.deliveryDate || row.pickupDate || "Carrier update",
    completed: state !== "tracking_pending" && state !== "not_found"
  }];

  return {
    success: !blocked && !notFound && (tforcePageHasResult(text, tracking) || hasParsedTForceDetails),
    found: !blocked && !notFound && (tforcePageHasResult(text, tracking) || hasParsedTForceDetails),
    blocked: blocked,
    reason: blocked ? "CAPTCHA_OR_ACCESS_BLOCK" : notFound ? "NOT_FOUND" : (tforcePageHasResult(text, tracking) || hasParsedTForceDetails) ? "" : "TFORCE_DETAILS_NOT_RETURNED",
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
      date: row.deliveryDate && row.deliveredAt ? row.deliveryDate + " " + row.deliveredAt : row.deliveryDate || row.estimatedDelivery || "",
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
      referenceNumber: row.referenceNumber || "",
      purchaseOrderNumber: row.purchaseOrderNumber || "",
      terminal: row.terminal || "",
      pickupDate: row.pickupDate || "",
      estimatedDelivery: row.estimatedDelivery || "",
      deliveryDate: row.deliveryDate || "",
      deliveredAt: row.deliveredAt || "",
      signedBy: row.signedBy || "",
      origin: row.origin || "",
      destination: row.destination || "",
      travelHistory: events.map(function(event){
        return {
          status: event.status,
          description: event.description,
          location: event.location.display,
          time: event.timestamp,
          trailer: event.trailer || ""
        };
      })
    },
    billOfLading: row.bol || "",
      referenceNumber: row.referenceNumber || "",
      purchaseOrderNumber: row.purchaseOrderNumber || "",
      terminal: row.terminal || "",
    bol: row.bol || "",
    referenceNumber: row.referenceNumber || "",
    purchaseOrderNumber: row.purchaseOrderNumber || "",
    terminal: row.terminal || "",
    shipDate: row.pickupDate || "",
    signedBy: row.signedBy || "",
    source: "Render TForce Freight",
    pageText: text.slice(0, 30000),
    debug: {
      title: options.title || "",
      url: finalUrl,
      parsedRow: row
    }
  };
}


function firstMatch(text, patterns){
  const value = String(text || "");

  for(const pattern of patterns){
    const match = value.match(pattern);
    if(match && match[1]){
      return cleanTextValue(match[1]);
    }

    if(match && match[0]){
      return cleanTextValue(match[0]);
    }
  }

  return "";
}


function parseTForceText(text, tracking){
  const clean = cleanTextValue(String(text || ""));
  const block = getTForceResultBlock(clean, tracking);
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
    deliveredAt: "",
    signedBy: "",
    origin: "",
    destination: "",
    currentLocation: "",
    shipFromName: "",
    shipToName: "",
    events: []
  };

  result.pro = firstMatch(block, [
    /PRO\(S\)\s+RELATED\s+TO\s+(\d{7,12})/i,
    /PRO\s*(?:Number|#)?\s*:?\s*(\d{7,12})/i,
    /Tracking\s*(?:Number|#)?\s*:?\s*(\d{7,12})/i
  ]) || tracking;

  result.status = getTForceStatusFromBlock(block);

  result.deliveryDate = firstMatch(block, [
    /Delivered\s+On\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Delivery\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.deliveredAt = firstMatch(block, [
    /Delivered\s+At\s*\n?\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/i
  ]);

  result.signedBy = firstMatch(block, [
    /Signed\s+By\s*\n?\s*([A-Za-z0-9 .'-]+?)(?=\n|Service|Send Updates|Show Details|Ship To|$)/i
  ]);

  result.service = firstMatch(block, [
    /Service\s*\n?\s*([A-Za-z0-9 \-/]+?)(?=\n|Send Updates|Show Details|Ship To|$)/i
  ]) || "TForce Freight";

  const shipTo = parseTForcePartyBlock(block, "Ship To", ["Ship From", "Tracking results provided", "Customize Your Tracking"]);
  result.shipToName = shipTo.name;
  result.destination = shipTo.location;

  const shipFrom = parseTForcePartyBlock(block, "Ship From", ["Tracking results provided", "Customize Your Tracking", "Need Help"]);
  result.shipFromName = shipFrom.name;
  result.origin = shipFrom.location;

  result.currentLocation = result.status.toLowerCase().indexOf("delivered") >= 0 ? result.destination : (result.origin || result.destination || "");

  result.pickupDate = firstMatch(block, [
    /Pickup\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /Ship\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.estimatedDelivery = firstMatch(block, [
    /Estimated\s*Delivery\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /ETA\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.pieces = firstMatch(block, [
    /Pieces\s*:?\s*([0-9,]+)/i,
    /Total\s*Pieces\s*:?\s*([0-9,]+)/i,
    /Handling\s*Units\s*:?\s*([0-9,]+)/i
  ]);

  result.handlingUnits = firstMatch(block, [
    /Handling\s*Units\s*:?\s*([0-9,]+)/i
  ]) || result.pieces;

  result.weight = firstMatch(block, [
    /Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /Shipment\s*Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i
  ]);

  result.bol = firstMatch(block, [
    /BOL\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i,
    /Bill\s*of\s*Lading\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i
  ]);

  const expanded = parseTForceExpandedDetails(block);
  result.pieces = result.pieces || expanded.pieces || "";
  result.handlingUnits = result.handlingUnits || expanded.handlingUnits || result.pieces || "";
  result.weight = result.weight || expanded.weight || "";
  result.bol = result.bol || expanded.bol || "";
  result.pickupDate = result.pickupDate || expanded.pickupDate || expanded.shipDate || "";
  result.referenceNumber = expanded.referenceNumber || "";
  result.purchaseOrderNumber = expanded.purchaseOrderNumber || "";
  result.terminal = expanded.terminal || "";

  const progressEvents = parseTForceShipmentProgress(block);
  result.events = progressEvents.length ? progressEvents : buildTForceCleanEvents(result);

  return result;
}

function getTForceResultBlock(text, tracking){
  const value = String(text || "");
  const marker = "PRO(S) RELATED TO " + tracking;
  let start = value.indexOf(marker);

  if(start < 0){
    start = value.indexOf(String(tracking || ""));
  }

  if(start < 0){
    return value;
  }

  let end = value.indexOf("Customize Your Tracking With APIs", start);
  if(end < 0) end = value.indexOf("Need Help?", start);
  if(end < 0) end = value.indexOf("Website Terms of Use", start);
  if(end < 0) end = Math.min(value.length, start + 4000);

  return value.slice(start, end);
}

function getTForceStatusFromBlock(block){
  const value = String(block || "");
  const lines = compactTrackingLines(value);
  const validStatuses = ["Delivered", "Out for Delivery", "In Transit", "Picked Up", "Exception", "Appointment Pending"];

  for(const status of validStatuses){
    if(lines.some(function(line){ return line.trim().toLowerCase() === status.toLowerCase(); })){
      return status;
    }
  }

  if(/SHIPMENT HAS BEEN DELIVERED TO THE CONSIGNEE/i.test(value)){
    return "Delivered";
  }

  return firstMatch(value, [
    /\b(Delivered|Out for Delivery|In Transit|Picked Up|Exception|Appointment Pending)\b/i
  ]) || "Tracking Found";
}

function parseTForcePartyBlock(block, label, endLabels){
  const result = {
    name: "",
    location: ""
  };

  const value = String(block || "");
  const startRegex = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\n?", "i");
  const startMatch = value.match(startRegex);

  if(!startMatch || startMatch.index === undefined){
    return result;
  }

  const start = startMatch.index + startMatch[0].length;
  let end = value.length;

  for(const endLabel of endLabels){
    const idx = value.search(new RegExp(endLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    if(idx > start && idx < end){
      end = idx;
    }
  }

  const lines = value.slice(start, end).split(/\n+/).map(function(line){
    return cleanTextValue(line);
  }).filter(Boolean);

  if(lines.length){
    result.name = lines[0] || "";
  }

  const locationLine = lines.find(function(line){
    return /^[A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?(?:\s+US| USA)?$/i.test(line);
  });

  if(locationLine){
    result.location = cleanTForceLocation(locationLine);
  } else if(lines.length >= 2){
    result.location = cleanTForceLocation(lines[1]);
  }

  return result;
}

function buildTForceCleanEvents(row){
  const events = [];

  if(String(row.status || "").toLowerCase().indexOf("delivered") >= 0){
    const timestamp = row.deliveryDate && row.deliveredAt ? row.deliveryDate + " " + row.deliveredAt : row.deliveryDate || "Carrier update";

    events.push({
      status: "Delivered",
      description: row.signedBy ? "Signed by: " + row.signedBy : "Shipment delivered",
      location: normalizeSimpleLocation(row.destination || "TForce Freight"),
      timestamp: timestamp,
      completed: true
    });

    return events;
  }

  if(row.status){
    events.push({
      status: normalizeTForceStatus(row.status),
      description: row.status,
      location: normalizeSimpleLocation(row.currentLocation || row.destination || row.origin || "TForce Freight"),
      timestamp: row.estimatedDelivery || row.pickupDate || "Carrier update",
      completed: true
    });
  }

  return events;
}



function parseTForceShipmentProgress(block){
  const events = [];
  const value = String(block || "");
  const start = value.search(/Shipment Progress/i);

  if(start < 0){
    return events;
  }

  let end = value.search(/Hide Details|Shipment Details|Tracking results provided|Customize Your Tracking/i);
  if(end < start){
    end = Math.min(value.length, start + 5000);
  }

  const chunk = value.slice(start, end);
  const lines = chunk.split(/\n+/).map(function(line){
    return cleanTextValue(line);
  }).filter(Boolean);

  for(let i = 0; i < lines.length; i++){
    const line = lines[i];

    if(/^(Location|Date|Time|Activity|Trailer|Shipment Progress)$/i.test(line)){
      continue;
    }

    const tabMatch = line.match(/^(.+?,\s*[A-Z]{2})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.+?)(?:\s+([0-9A-Z]+\s+[A-Z0-9]+))?$/i);
    if(tabMatch){
      events.push({
        status: normalizeTForceProgressActivity(tabMatch[4]),
        description: cleanTextValue(tabMatch[4]),
        location: normalizeSimpleLocation(cleanTextValue(tabMatch[1])),
        timestamp: cleanTextValue(tabMatch[2] + " " + tabMatch[3]),
        trailer: cleanTextValue(tabMatch[5] || ""),
        completed: true
      });
      continue;
    }

    const location = /^[A-Za-z .'-]+,\s*[A-Z]{2}$/i.test(line) ? line : "";
    const date = lines[i + 1] || "";
    const time = lines[i + 2] || "";
    const activity = lines[i + 3] || "";
    const trailer = lines[i + 4] || "";

    if(location && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date) && /^\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(time) && activity){
      events.push({
        status: normalizeTForceProgressActivity(activity),
        description: cleanTextValue(activity),
        location: normalizeSimpleLocation(location),
        timestamp: cleanTextValue(date + " " + time),
        trailer: /^[0-9A-Z]+\s+[A-Z0-9]+$/i.test(trailer) ? trailer : "",
        completed: true
      });

      i += /^[0-9A-Z]+\s+[A-Z0-9]+$/i.test(trailer) ? 4 : 3;
    }
  }

  return events.reverse();
}

function normalizeTForceProgressActivity(activity){
  const text = cleanTextValue(activity);
  const lower = text.toLowerCase();

  if(lower.indexOf("delivered") >= 0 || lower.indexOf("consignee") >= 0) return "Delivered";
  if(lower.indexOf("out for delivery") >= 0) return "Out For Delivery";
  if(lower.indexOf("picked-up") >= 0 || lower.indexOf("picked up") >= 0) return "Picked Up";
  if(lower.indexOf("departure") >= 0) return "Departed";
  if(lower.indexOf("arrived") >= 0 || lower.indexOf("service center") >= 0) return "Arrived At Service Center";
  if(lower.indexOf("tforce freight location") >= 0) return "At TForce Freight Location";

  return text || "Carrier Update";
}


function parseTForceExpandedDetails(block){
  const result = {
    pieces: "",
    handlingUnits: "",
    weight: "",
    bol: "",
    pickupDate: "",
    shipDate: "",
    referenceNumber: "",
    purchaseOrderNumber: "",
    consignee: "",
    shipper: "",
    terminal: ""
  };

  const value = cleanTextValue(String(block || ""));
  const flat = value.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  result.pieces = firstMatch(flat, [
    /Pieces\s*:?\s*([0-9,]+)/i,
    /Total\s*Pieces\s*:?\s*([0-9,]+)/i,
    /Piece\s*Count\s*:?\s*([0-9,]+)/i
  ]);

  result.handlingUnits = firstMatch(flat, [
    /Handling\s*Units\s*:?\s*([0-9,]+)/i,
    /HU\s*:?\s*([0-9,]+)/i
  ]) || result.pieces;

  result.weight = firstMatch(flat, [
    /Shipment\s*Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i,
    /Total\s*Weight\s*:?\s*([0-9,]+(?:\.[0-9]+)?\s*(?:lbs?|pounds?)?)/i
  ]);

  result.bol = firstMatch(flat, [
    /BOL\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i,
    /Bill\s*of\s*Lading\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i
  ]);

  result.pickupDate = firstMatch(flat, [
    /Pickup\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i,
    /Picked\s*Up\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]);

  result.shipDate = firstMatch(flat, [
    /Ship\s*Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i
  ]) || result.pickupDate;

  result.referenceNumber = firstMatch(flat, [
    /Reference\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i
  ]);

  result.purchaseOrderNumber = firstMatch(flat, [
    /Purchase\s*Order\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i,
    /PO\s*(?:Number|#)?\s*:?\s*([A-Za-z0-9-]+)/i
  ]);

  result.terminal = firstMatch(flat, [
    /Terminal\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i,
    /Service\s*Center\s*:?\s*([A-Za-z .'-]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i
  ]);

  return result;
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
    const result = await withTimeout(scrapeEstesTracking(tracking), 70000, "Estes Express tracking");
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
