// netlify/functions/updateSheet.js
const { google } = require('googleapis');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');

exports.handler = async (event) => {
  // Check if this is a scheduled event
  const isScheduled = event.headers['x-netlify-scheduled'];
  if (!isScheduled) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "This function can only be triggered by a schedule." }),
    };
  }

  try {
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
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    console.log('Navigating to the telemetry page...');
    await page.goto('https://telemetry.subspace.network/#list/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34');

    await page.waitForTimeout(5000);

    console.log('Extracting node count...');
    const nodeCount = await page.evaluate(() => {
      const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
      return element ? parseInt(element.textContent) : null;
    });

    await browser.close();

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
        values: [[timestamp, nodeCount, spacePledged]]
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Data updated successfully" }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to update data" }),
    };
  }
};