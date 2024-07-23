const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables from a .env file
dotenv.config();

async function runScript() {
  let browser;
  try {
    console.log("Function invoked locally at:", new Date().toISOString());

    // Set up authentication
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Your Google Sheet ID
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Launch puppeteer
    browser = await puppeteer.launch({
      headless: "new"  // Use new headless mode
    });

    const page = await browser.newPage();

    console.log('Navigating to the telemetry page...');
    await page.goto('https://telemetry.subspace.network/#list/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', {
      waitUntil: 'networkidle0'
    });

    console.log('Extracting stats...');
    const stats = await page.evaluate(() => {
      const getTextBySelector = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : null;
      };

      const nodeCount = (() => {
        const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
        return element ? parseInt(element.textContent) : null;
      })();

      const subspaceNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count");
      const spaceAcresNodeCount = getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count");

      return {
        nodeCount,
        subspaceNodeCount: subspaceNodeCount ? parseInt(subspaceNodeCount) : null,
        spaceAcresNodeCount: spaceAcresNodeCount ? parseInt(spaceAcresNodeCount) : null
      };
    });

    console.log('Stats extracted:', stats);

    console.log('Making API request...');
    const apiResponse = await axios.get('https://telemetry.subspace.network/api');
    const spacePledged = apiResponse.data.spacePledged;

    const timestamp = new Date().toISOString();

    // Append to Google Sheet
    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[timestamp, stats.nodeCount, spacePledged, stats.subspaceNodeCount, stats.spaceAcresNodeCount]]
      },
    });

    console.log('Sheet updated successfully:', appendResult.data);

    console.log("Data updated successfully");
  } catch (error) {
    console.error('Error details:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runScript();