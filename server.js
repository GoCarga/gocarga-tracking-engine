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

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    });

    await page.goto(
      "https://view.arcb.com/nlo/tools/tracking",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000
      }
    );

    await page.waitForTimeout(10000);

    const inputSelectors = [
      "input[aria-label*='Tracking']",
      "input[type='text']",
      "input[type='search']",
      "input:not([type])",
      "textarea",
      "input"
    ];

    let filled = false;

    for(const frame of page.frames()){

      for(const selector of inputSelectors){

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

              el.value = value;

              el.dispatchEvent(new Event("input", {
                bubbles: true
              }));

              el.dispatchEvent(new Event("change", {
                bubbles: true
              }));

            }, tracking);

            filled = true;
            break;
          }
        }

        if(filled){
          break;
        }
      }

      if(filled){
        break;
      }
    }

    if(!filled){

      throw new Error(
        "ABF tracking input was not found in page or frames"
      );
    }

    await page.waitForTimeout(3000);

    const buttonSelectors = [
      "button:has-text('Track Shipment')",
      "button:has-text('Track')",
      "input[type='submit']",
      "[role='button']:has-text('Track Shipment')",
      "[role='button']:has-text('Track')",
      "button"
    ];

    let clicked = false;

    for(const frame of page.frames()){

      for(const selector of buttonSelectors){

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

            clicked = true;
            break;
          }
        }

        if(clicked){
          break;
        }
      }

      if(clicked){
        break;
      }
    }

    if(!clicked){

      throw new Error(
        "ABF Track Shipment button was not found"
      );
    }

    await page.waitForTimeout(10000);

    const finalUrl = page.url();

    await browser.close();

    return res.json({
      success: true,
      tracking: tracking,
      finalUrl: finalUrl
    });

  } catch(error){

    console.log(error);

    if(browser){
      await browser.close();
    }

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", function(){
  console.log("Server running on port " + port);
});
