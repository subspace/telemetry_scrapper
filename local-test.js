const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables from a .env file
dotenv.config();

const MAX_RETRIES = 3;
const TIMEOUT = 50000; // 50 seconds

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === retries - 1) throw error;
    }
  }
}

async function runScript() {
  let browser;
  try {
    console.log("Function invoked locally at:", new Date().toISOString());

    // Set up authentication for Google Sheets
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Your Google Sheet ID
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Launch puppeteer
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => {
      console.error('Page error:', error.message);
    });

    console.log('Navigating to the telemetry page...');
    await Promise.race([
      page.goto('https://telemetry.subspace.network/#/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', {
        waitUntil: 'networkidle0',
        timeout: 30000
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 30000))
    ]);

    console.log('Page loaded. Waiting for 5 seconds...');
    await wait(5000);

    console.log('Page content after initial load:', await page.content());

    console.log('Clicking on the Stats tab...');
    await page.click('.Chain-Tab[title="Stats"]');
    await page.waitForSelector('.Chain-content table', { timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds after clicking

    console.log('Page content after clicking Stats tab:', await page.content());

    console.log('Extracting stats...');
    const stats = await page.evaluate(() => {
      const getTextByMultipleSelectors = (selectors) => {
        for (const selector of selectors) {
          let element;
          try {
            if (selector.startsWith('/')) {
              // XPath
              element = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            } else {
              // CSS selector
              element = document.querySelector(selector);
            }
            if (element) {
              console.log(`Found element using selector: ${selector}`);
              return element.textContent.trim();
            }
          } catch (error) {
            console.log(`Error with selector ${selector}:`, error.message);
          }
        }
        console.log('Element not found with any selector');
        return null;
      };

      const nodeCount = getTextByMultipleSelectors(['.Chains-chain-selected .Chains-node-count']);
      
      const subspaceNodeCount = getTextByMultipleSelectors([
        "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count",
        "//*[@id='root']/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[1]/td[2]",
        "/html/body/div/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[1]/td[2]"
      ]);
      
      const spaceAcresNodeCount = getTextByMultipleSelectors([
        "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count",
        "//*[@id='root']/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[2]/td[2]",
        "/html/body/div/div/div[2]/div[2]/div/div/div[2]/table/tbody/tr[2]/td[2]"
      ]);

      const linuxNodeCount = getTextByMultipleSelectors([
        "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(1) > td.Stats-count",
        "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]",
        "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]"
      ]);

      const windowsNodeCount = getTextByMultipleSelectors([
        "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(2) > td.Stats-count",
        "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]",
        "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]"
      ]);

      const macosNodeCount = getTextByMultipleSelectors([
        "#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(3) > table > tbody > tr:nth-child(3) > td.Stats-count",
        "//*[@id='root']/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]",
        "/html/body/div/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]"
      ]);

      console.log('Full Chain-content:', document.querySelector('.Chain-content').outerHTML);

      return {
        nodeCount: nodeCount ? parseInt(nodeCount) : null,
        subspaceNodeCount: subspaceNodeCount ? parseInt(subspaceNodeCount) : null,
        spaceAcresNodeCount: spaceAcresNodeCount ? parseInt(spaceAcresNodeCount) : null,
        linuxNodeCount: linuxNodeCount ? parseInt(linuxNodeCount) : null,
        windowsNodeCount: windowsNodeCount ? parseInt(windowsNodeCount) : null,
        macosNodeCount: macosNodeCount ? parseInt(macosNodeCount) : null
      };
    });

    console.log('Stats extracted:', stats);

    console.log('Making API request...');
    const apiResponse = await axios.get('https://telemetry.subspace.network/api', { timeout: 5000 });
    const spacePledged = apiResponse.data.spacePledged;
    console.log('Space pledged:', spacePledged);

    const timestamp = new Date().toISOString();

    // Append to Google Sheet
    console.log('Appending to Google Sheet...');
    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          timestamp, 
          stats.nodeCount || '', 
          spacePledged || '', 
          stats.subspaceNodeCount || '', 
          stats.spaceAcresNodeCount || '',
          stats.linuxNodeCount || '',
          stats.windowsNodeCount || '',
          stats.macosNodeCount || ''
        ]]
      },
    });

    console.log('Data appended to Google Sheet:', appendResult.data);
    console.log('Function completed successfully');

  } catch (error) {
    console.error('Error details:', error);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

runWithRetry(runScript);