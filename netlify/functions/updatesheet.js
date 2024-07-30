import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';

const MAX_RETRIES = 3;

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

export default async (req, context) => {
  return await runWithRetry(async () => {
    let browser;
    try {
      const { next_run } = req.body;
      console.log("Function invoked. Next run scheduled for:", next_run);
      console.log("Current time:", new Date().toISOString());

      console.log("Setting up Google authentication...");
      const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
        key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      console.log("Using Google Sheet ID:", spreadsheetId);

      console.log("Launching browser...");
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

      const page = await browser.newPage();
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));

      console.log('Navigating to the telemetry page...');
      try {
        await page.goto('https://telemetry.subspace.network/#/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', {
          waitUntil: 'networkidle0',
          timeout: 60000
        });
      } catch (error) {
        console.error('Navigation failed:', error);
        throw error;
      }

      console.log('Page loaded. Waiting for 5 seconds...');
      await page.waitForTimeout(5000);

      console.log('Clicking on the specified element...');
      const clickResult = await page.evaluate(() => {
        const element = document.evaluate(
          '//*[@id="root"]/div/div[2]/div[1]/div[6]/div[3]',
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        if (element) {
          element.click();
          return 'Element clicked';
        } else {
          return 'Element not found';
        }
      });
      console.log('Click result:', clickResult);

      console.log('Waiting after click...');
      await page.waitForTimeout(2000);

      console.log('Extracting stats...');
      const stats = await page.evaluate(() => {
        // ... (same as before)
      });

      console.log('Stats extracted:', stats);

      console.log('Making API request...');
      const apiResponse = await axios.get('https://telemetry.subspace.network/api');
      const spacePledged = apiResponse.data.spacePledged;
      console.log('Space pledged:', spacePledged);

      const timestamp = new Date().toISOString();

      console.log('Appending to Google Sheet...');
      const appendResult = await sheets.spreadsheets.values.append({
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
      console.log('Append result:', appendResult.data);

      console.log('Function completed successfully');
      return new Response(JSON.stringify({ message: "Data updated successfully", nextRun: next_run }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error details:', error);
      throw error;
    } finally {
      if (browser) {
        console.log('Closing browser...');
        await browser.close();
      }
    }
  });
}

export const config = {
  schedule: "@hourly"
}