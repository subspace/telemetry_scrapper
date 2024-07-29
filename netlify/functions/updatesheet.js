import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';

export default async (req, context) => {
  let browser;
  try {
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
    await page.waitForTimeout(2000);

    console.log('Extracting stats...');
    const stats = await page.evaluate(() => {
      // ... (rest of your stats extraction code remains the same)
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

    return new Response(JSON.stringify({ message: "Data updated successfully", nextRun: next_run }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error details:', error);
    return new Response(JSON.stringify({ error: "Failed to update data", details: error.message }), {
      status: 500,
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