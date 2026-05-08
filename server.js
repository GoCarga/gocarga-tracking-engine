const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();

app.use(express.json());

app.use(cors({
  origin: "*"
}));

app.get("/", function(req, res){
  res.json({
    ok: true,
    service: "GoCarga Tracking Engine"
  });
});

async function launchBrowser(){
  return await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });
}

async function fillInputBySelectors(page, selectors, value){
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
          await field.evaluate(function(el, inputValue){
            el.focus();

            if(el.isContentEditable){
              el.textContent = inputValue;
            } else {
              el.value = inputValue;
            }

            const eventOptions = {
              bubbles: true,
              cancelable: true
            };

            el.dispatchEvent(new Event("input", eventOptions));
            el.dispatchEvent(new Event("change", eventOptions));
            el.dispatchEvent(new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "1"
            }));
            el.dispatchEvent(new KeyboardEvent("keyup", {
              bubbles: true,
              cancelable: true,
              key: "1"
            }));
          }, value);

          return true;
        }
      }
    }
  }

  return false;
}

async function typeInputBySelectors(page, selectors, value){
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
          await field.click({
            force: true,
            timeout: 10000
          }).catch(function(){});

          await field.press("Control+A").catch(function(){});
          await field.press("Meta+A").catch(function(){});
          await field.fill("").catch(function(){});
          await field.type(value, {
            delay: 50
          });

          await field.evaluate(function(el){
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
            el.blur();
          });

          return true;
        }
      }
    }
  }

  return false;
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

app.post("/track-abf", async function(req, res){
  const tracking = String(req.body.tracking || "").trim();

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

    const filled = await fillInputBySelectors(page, [
      "input[aria-label*='Tracking']",
      "input[type='text']",
      "input[type='search']",
      "input:not([type])",
      "textarea",
      "input"
    ], tracking);

    if(!filled){
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

    if(!clicked){
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
      error: error.message
    });
  }
});

app.post("/track-aaa", async function(req, res){
  const tracking = String(req.body.tracking || "").trim();

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

    await page.goto("https://www.aaacooper.com/pwb/Transit/ProTrackResults.aspx", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(8000);

    const filled = await typeInputBySelectors(page, [
      "input[name*='Pro']",
      "input[id*='Pro']",
      "input[name*='pro']",
      "input[id*='pro']",
      "input[type='text']",
      "textarea",
      "input"
    ], tracking);

    if(!filled){
      throw new Error("AAA Cooper PRO input was not found");
    }

    await page.waitForTimeout(2000);

    const clicked = await clickBySelectors(page, [
      "input[type='submit']",
      "button:has-text('Track')",
      "button:has-text('Submit')",
      "button:has-text('Search')",
      "[role='button']:has-text('Track')",
      "[role='button']:has-text('Submit')",
      "button"
    ]);

    if(!clicked){
      throw new Error("AAA Cooper tracking button was not found");
    }

    await page.waitForTimeout(12000);

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      carrier: "AAA Cooper",
      tracking: tracking,
      finalUrl: finalUrl
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

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log("Server running on port " + port);
});
