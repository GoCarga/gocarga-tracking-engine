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
            el.value = inputValue;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
          }, value);

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

app.post("/track-saia", async function(req, res){
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

    await page.goto("https://www.saia.com/track", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(12000);

    const captchaVisible = await page.locator("iframe[src*='recaptcha'], .g-recaptcha, text=I'm not a robot").count().catch(function(){
      return 0;
    });

    if(captchaVisible > 0){
      await browser.close();

      return res.status(409).json({
        success: false,
        carrier: "SAIA",
        error: "SAIA is showing a CAPTCHA. Manual verification is required.",
        finalUrl: "https://www.saia.com/track"
      });
    }

    const saiaFilled = await page.evaluate(function(value){
      const fields = Array.from(document.querySelectorAll("textarea, input"));
      const field = document.querySelector("#trackingNumbers") ||
        document.querySelector("textarea[formcontrolname='proNumbers']") ||
        document.querySelector("textarea[name*='pro']") ||
        document.querySelector("textarea");

      if(!field){
        return false;
      }

      field.focus();
      field.value = value;

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      );

      if(nativeInputValueSetter && nativeInputValueSetter.set){
        nativeInputValueSetter.set.call(field, value);
      }

      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "1" }));
      field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "1" }));
      field.blur();

      return true;
    }, tracking);

    if(!saiaFilled){
      throw new Error("SAIA PRO textarea was not found");
    }

    await page.waitForTimeout(3000);

    const clicked = await page.evaluate(function(){
      const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"));

      const button = buttons.find(function(el){
        const text = (el.innerText || el.value || el.textContent || "").trim().toUpperCase();
        return text.includes("TRACK");
      });

      if(button){
        button.click();
        return true;
      }

      return false;
    });

    if(!clicked){
      throw new Error("SAIA Track button was not found");
    }

    await page.waitForTimeout(15000);

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      carrier: "SAIA",
      tracking: tracking,
      finalUrl: finalUrl
    });

  } catch(error){
    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      carrier: "SAIA",
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log("Server running on port " + port);
});
