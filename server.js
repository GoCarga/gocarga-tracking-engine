const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(express.json());

app.use(cors({
  origin: "*"
}));

const carrierConfigs = {

  "track-abf": {
    service: "ABF Freight",
    url: "https://view.arcb.com/nlo/tools/tracking",
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
  },

  "track-saia": {
    service: "SAIA",
    url: "https://www.saia.com/tracking",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Track')",
      "button:has-text('Submit')",
      "input[type='submit']",
      "button"
    ]
  },

  "track-od": {
    service: "Old Dominion",
    url: "https://www.odfl.com/us/en/tools/trace-track-ltl-freight.html",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Trace')",
      "button:has-text('Track')",
      "button:has-text('Search')",
      "input[type='submit']",
      "button"
    ]
  },

  "track-oakh": {
    service: "Oak Harbor",
    url: "https://www.oakh.com/page/tracing",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Trace')",
      "button:has-text('Track')",
      "button:has-text('Search')",
      "input[type='submit']",
      "button"
    ]
  },

  "track-aaa": {
    service: "AAA Cooper",
    url: "https://www.aaacooper.com/pwb/Transit/ProTrackResults.aspx",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Track')",
      "button:has-text('Search')",
      "input[type='submit']",
      "button"
    ]
  },

  "track-diamond": {
    service: "Diamond Line Express",
    url: "https://tracking.carrierlogistics.com/scripts/dlds.pol/protrace.htm?seskey=&language=&nav=top",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Trace')",
      "button:has-text('Track')",
      "button:has-text('Search')",
      "input[type='submit']",
      "button"
    ]
  },

  "track-stg": {
    service: "STG LTL",
    url: "https://www.stgltl.com/",
    inputSelectors: [
      "input[placeholder*='PRO']",
      "input[aria-label*='PRO']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "input"
    ],
    buttonSelectors: [
      "button:has-text('Track')",
      "button:has-text('Search')",
      "input[type='submit']",
      "button"
    ]
  }

};

app.get("/", function(req, res){

  res.json({
    ok: true,
    service: "GoCarga Multi-Carrier Tracking"
  });

});

async function fillInputInFrames(page, selectors, tracking){

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

          await field.evaluate(function(el, value){

            el.focus();

            if(el.isContentEditable){
              el.textContent = value;
            } else {
              el.value = value;
            }

            el.dispatchEvent(new Event("input", {
              bubbles: true
            }));

            el.dispatchEvent(new Event("change", {
              bubbles: true
            }));

            el.dispatchEvent(new KeyboardEvent("keyup", {
              bubbles: true
            }));

          }, tracking);

          return true;
        }
      }
    }
  }

  return false;
}

async function clickButtonInFrames(page, selectors){

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

          await button.evaluate(function(el){
            el.click();
          });

          return true;
        }
      }
    }
  }

  return false;
}

async function runCarrierTracking(config, tracking){

  let browser;

  try {

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    });

    await page.goto(
      config.url,
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(10000);

    const filled = await fillInputInFrames(
      page,
      config.inputSelectors,
      tracking
    );

    if(!filled){
      throw new Error(
        config.service + " tracking input was not found"
      );
    }

    await page.waitForTimeout(3000);

    const clicked = await clickButtonInFrames(
      page,
      config.buttonSelectors
    );

    if(!clicked){
      throw new Error(
        config.service + " tracking button was not found"
      );
    }

    await page.waitForTimeout(12000);

    const finalUrl = page.url();

    await browser.close();

    return {
      success: true,
      carrier: config.service,
      tracking: tracking,
      finalUrl: finalUrl
    };

  } catch(error){

    if(browser){
      await browser.close();
    }

    return {
      success: false,
      carrier: config.service,
      error: error.message
    };
  }
}

Object.keys(carrierConfigs).forEach(function(routeName){

  app.post("/" + routeName, async function(req, res){

    const tracking = String(
      req.body.tracking || ""
    ).trim();

    if(!tracking){

      return res.status(400).json({
        success: false,
        error: "Tracking number required"
      });
    }

    const result = await runCarrierTracking(
      carrierConfigs[routeName],
      tracking
    );

    if(result.success){
      return res.json(result);
    }

    return res.status(500).json(result);

  });

});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log(
    "Server running on port " + port
  );
});
