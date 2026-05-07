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
        "--disable-setuid-sandbox"
      ]
    });

    const page = await browser.newPage();

    await page.goto(
      "https://view.arcb.com/nlo/tools/tracking",
      {
        waitUntil: "domcontentloaded",
        timeout: 45000
      }
    );

    await page.locator("input").first().fill(tracking);

    await page.locator("button").first().click();

    await page.waitForTimeout(5000);

    const finalUrl = page.url();

    await browser.close();

    res.json({
      success: true,
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