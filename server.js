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
    routes: ["/track-abf", "/track-aaa", "/track-fedex", "/debug-aaa"]
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

function cleanTracking(value){
  return String(value || "").trim().replace(/\s+/g, "");
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

    await page.waitForTimeout(10000);

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


app.post("/track-fedex", async function(req, res){
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

    const directUrl = "https://www.fedexfreight.com/fedextrack/?trknbr=" + encodeURIComponent(tracking) + "&trkqual=~" + encodeURIComponent(tracking) + "~FDFR";

    await page.goto(directUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(12000);

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

      await page.waitForTimeout(2000);

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

    return res.json({
      success: true,
      carrier: "FedEx Freight",
      tracking: tracking,
      found: found,
      blocked: blocked,
      finalUrl: finalUrl,
      pageText: bodyText.slice(0, 15000),
      debug: {
        title: report.title || "",
        url: report.url || finalUrl
      }
    });

  } catch(error){
    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      carrier: "FedEx Freight",
      tracking: tracking,
      error: error.message,
      finalUrl: "https://www.fedexfreight.com/fedextrack/?trknbr=" + encodeURIComponent(tracking) + "&trkqual=~" + encodeURIComponent(tracking) + "~FDFR"
    });
  }
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
