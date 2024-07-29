import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';

function withTimeout(promise, ms) {
  let timeout = new Promise((_, reject) => {
    let id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Timed out in ${ms} ms.`))
    }, ms)
  })

  return Promise.race([
    promise,
    timeout
  ])
}

export default async (req, context) => {
  let browser;
  try {
    await withTimeout(async () => {
      const { next_run } = req.body;
      console.log("Function invoked. Next run scheduled for:", next_run);

      // Set up authentication
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      // Your Google Sheet ID
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;

      // Set up puppeteer with chromium
      browser = await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });

      const page = await browser.newPage();

      // Add more detailed logging
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('error', error => console.error('PAGE ERROR:', error));
      browser.on('disconnected', () => console.log('Browser disconnected'));

      // Implement retry mechanism for navigation
      const navigateWithRetry = async (url, maxRetries = 3) => {
        for (let i = 0; i < maxRetries; i++) {
          try {
            console.log(`Navigation attempt ${i + 1} to ${url}`);
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            console.log('Navigation successful');
            return;
          } catch (error) {
            console.error(`Navigation attempt ${i + 1} failed:`, error);
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      };

      await navigateWithRetry('https://telemetry.subspace.network/#/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34');

      // Check if page loaded correctly
      const isPageLoaded = await page.evaluate(() => document.readyState === 'complete');
      if (!isPageLoaded) {
        throw new Error('Page did not finish loading');
      }

      console.log('Page loaded successfully');

      // Wait for a specific element instead of a fixed time
      await page.waitForSelector('.Chains-chain-selected', { timeout: 10000 });

      // Click on the specified element
      console.log('Clicking on the specified element...');
      await page.evaluate(() => {
        const element = document.evaluate(
          '//*[@id="root"]/div/div[2]/div[1]/div[6]/div[3]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        if (element) {
          element.click();
        } else {
          console.log('Element not found');
        }
      });

      // Wait for any changes after clicking
      console.log('Waiting after click...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('Extracting stats...');
      const stats = await page.evaluate(() => {
        const getTextBySelector = (selector) => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : null;
        };

        const getTextByXPath = (xpath) => {
          const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          return element ? element.textContent.trim() : null;
        };

        const nodeCount = (() => {
          const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
          return element ? parseInt(element.textContent) : null;
        })();

        const subspaceNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count");
        const spaceAcresNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count");

        const linuxNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]');
        const windowsNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]');
        const macosNodeCount = getTextByXPath('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]');

        return {
          nodeCount,
          subspaceNodeCount: subspaceNodeCount ? parseInt(subspaceNodeCount) : null,
          spaceAcresNodeCount: spaceAcresNodeCount ? parseInt(spaceAcresNodeCount) : null,
          linuxNodeCount: linuxNodeCount ? parseInt(linuxNodeCount) : null,
          windowsNodeCount: windowsNodeCount ? parseInt(windowsNodeCount) : null,
          macosNodeCount: macosNodeCount ? parseInt(macosNodeCount) : null
        };
      });

      console.log('Stats extracted:', stats);

      console.log('Making API request...');
      const apiResponse = await axios.get('https://telemetry.subspace.network/api');
      const spacePledged = apiResponse.data.spacePledged;

      const timestamp = new Date().toISOString();

      // Append to Google Sheet
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp, 
            stats.nodeCount, 
            spacePledged, 
            stats.subspaceNodeCount, 
            stats.spaceAcresNodeCount,
            stats.linuxNodeCount,
            stats.windowsNodeCount,
            stats.macosNodeCount
          ]]
        },
      });
    }, 25000); // 25 seconds timeout

    return new Response(JSON.stringify({ message: "Data updated successfully" }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error details:', error);
    return new Response(JSON.stringify({ error: "Failed to update data", details: error.message }), {
      status: error.message.includes('Timed out') ? 504 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export const config = {
  schedule: "@hourly"
}