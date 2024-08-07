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

    // Set up authentication for Google Sheets
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Your Google Sheet ID
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Launch puppeteer in headless mode
    browser = await puppeteer.launch({
      headless: true
    });

    const page = await browser.newPage();

    console.log('Navigating to the telemetry page...');
    await page.goto('https://telemetry.subspace.network/#/0x0c121c75f4ef450f40619e1fca9d1e8e7fbabc42c895bc4790801e85d5a91c34', {
      waitUntil: 'networkidle0'
    });

    // Wait for a bit to ensure the page has loaded
    console.log('Waiting for 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

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

    // Wait a bit for any changes after clicking
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Extracting stats...');
    const stats = await page.evaluate(() => {
      const getTextBySelector = (selector) => {
        const element = document.querySelector(selector);
        console.log(`Selector ${selector}:`, element ? element.textContent : 'Not found');
        return element ? element.textContent.trim() : null;
      };

      const getTextByXPath = (xpath) => {
        const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        console.log(`XPath ${xpath}:`, element ? element.textContent : 'Not found');
        return element ? element.textContent.trim() : null;
      };

      const nodeCount = (() => {
        const element = document.querySelector('.Chains-chain-selected .Chains-node-count');
        console.log('Node count element:', element ? element.textContent : 'Not found');
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

    console.log('Space pledged:', spacePledged);

    const timestamp = new Date().toISOString();

    // Append to Google Sheet
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

    console.log('Data appended to Google Sheet:', appendResult.data);

  } catch (error) {
    console.error('Error details:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runScript();