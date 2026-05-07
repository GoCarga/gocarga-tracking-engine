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
    service: "GoCarga ABF Tracking"
  });
});

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

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();

    await page.goto(
      "https://view.arcb.com/nlo/tools/tracking",
      {
        waitUntil: "networkidle",
        timeout: 60000
      }
    );

    await page.waitForTimeout(5000);

    const selectors = [
      "input[aria-label*='Tracking']",
      "input[placeholder*='Tracking']",
      "input[name*='tracking']",
      "input[id*='tracking']",
      "input[type='text']",
      "textarea"
    ];

    let filled = false;

    for(const selector of selectors){
      const elements = await page.locator(selector).count();

      if(elements > 0){
        const field = page.locator(selector).first();
        await field.waitFor({
          state: "visible",
          timeout: 15000
        });
        await field.fill(tracking);
        filled = true;
        break;
      }
    }

    if(!filled){
      throw new Error("ABF tracking input was not found after page loaded");
    }

    const buttons = [
      "button:has-text('Track Shipment')",
      "button:has-text('Track')",
      "input[type='submit']",
      "[role='button']:has-text('Track Shipment')",
      "[role='button']:has-text('Track')"
    ];

    let clicked = false;

    for(const selector of buttons){
      const elements = await page.locator(selector).count();

      if(elements > 0){
        const button = page.locator(selector).first();
        await button.waitFor({
          state: "visible",
          timeout: 15000
        });
        await button.click();
        clicked = true;
        break;
      }
    }

    if(!clicked){
      throw new Error("ABF Track Shipment button was not found");
    }

    await page.waitForTimeout(8000);

    const finalUrl = page.url();

    await browser.close();

    res.json({
      success: true,
      tracking: tracking,
      finalUrl: finalUrl
    });

  } catch(error){

    if(browser){
      await browser.close();
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log("Server running on port " + port);
});
