import { google } from 'googleapis';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { activate } from '@autonomys/auto-utils';
import { spacePledged } from '@autonomys/auto-consensus';

// Constants
const TIMEOUT = 60000;
const MAX_RETRIES = 3;
const INITIAL_WAIT = 10000;
const CLICK_WAIT = 5000;

// Helper function for waiting on elements
async function waitForElement(page, selector, timeout = 10000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.log(`Timeout waiting for selector: ${selector}`);
    return false;
  }
}

// Enhanced error handling for page scraping
async function scrapePageData(page, url, networkName) {
  console.log(`Starting scrape for ${networkName} at ${url}`);
  
  try {
    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      timeout: TIMEOUT 
    });
    
    const chainSelectorPresent = await waitForElement(page, '.Chains-chain-selected');
    if (!chainSelectorPresent) {
      throw new Error(`Chain selector not found for ${networkName}`);
    }

    // Wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, INITIAL_WAIT));

    // Enhanced click retry logic
    let clickSuccess = false;
    for (let i = 0; i < MAX_RETRIES && !clickSuccess; i++) {
      try {
        await page.evaluate(() => {
          const element = document.evaluate(
            '//*[@id="root"]/div/div[2]/div[1]/div[6]/div[3]',
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
          ).singleNodeValue;
          if (!element) throw new Error('Element not found');
          element.click();
          return true;
        });
        clickSuccess = true;
      } catch (error) {
        console.log(`${networkName}: Click attempt ${i + 1} failed`);
        if (i < MAX_RETRIES - 1) await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await new Promise(resolve => setTimeout(resolve, CLICK_WAIT));

    // Extract stats with error handling
    const stats = await page.evaluate((network) => {
      const getTextBySelector = (selector) => {
        try {
          const element = document.querySelector(selector);
          const value = element ? parseInt(element.textContent.trim()) : null;
          if (value === null) console.log(`${network}: Null value for selector ${selector}`);
          return value;
        } catch (error) {
          console.log(`${network}: Error getting text for selector ${selector}`);
          return null;
        }
      };

      return {
        nodeCount: getTextBySelector('.Chains-chain-selected .Chains-node-count'),
        subspaceNodeCount: getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(1) > td.Stats-count"),
        spaceAcresNodeCount: getTextBySelector("#root > div > div.Chain > div.Chain-content-container > div > div > div:nth-child(2) > table > tbody > tr:nth-child(2) > td.Stats-count"),
        linuxNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[1]/td[2]'),
        windowsNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[2]/td[2]'),
        macosNodeCount: getTextBySelector('//*[@id="root"]/div/div[2]/div[2]/div/div/div[3]/table/tbody/tr[3]/td[2]')
      };
    }, networkName);

    // Validate stats
    if (!stats.nodeCount) {
      throw new Error(`Failed to get valid stats for ${networkName}`);
    }

    console.log(`${networkName} stats extracted:`, stats);
    return stats;
  } catch (error) {
    console.error(`Error scraping ${networkName}:`, error);
    throw error;
  }
}

// Space pledged data retrieval with retry logic
async function getSpacePledgedData(network) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const api = await activate({ networkId: network });
      const data = await spacePledged(api);
      console.log(`${network} space pledged data:`, data);
      return data;
    } catch (error) {
      console.error(`Attempt ${i + 1}: Error fetching space pledged data for ${network}:`, error);
      if (i === MAX_RETRIES - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Main handler function
export const handler = async (event, context) => {
  let browser;
  try {
    // Initialize Google Sheets
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Launch browser with Netlify-specific configuration
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--dns-prefetch-disable',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    // Create pages and fetch data
    const [taurusPage, mainnetPage] = await Promise.all([
      browser.newPage(),
      browser.newPage()
    ]);

    const [taurusStats, mainnetStats] = await Promise.all([
      scrapePageData(
        taurusPage,
        'https://telemetry.subspace.foundation/#list/0x295aeafca762a304d92ee1505548695091f6082d3f0aa4d092ac3cd6397a6c5e',
        'taurus'
      ),
      scrapePageData(
        mainnetPage,
        'https://telemetry.subspace.network/#list/0x66455a580aabff303720aa83adbe6c44502922251c03ba73686d5245da9e21bd',
        'mainnet'
      )
    ]);

    const [taurusSpacePledged, mainnetSpacePledged] = await Promise.all([
      getSpacePledgedData('taurus'),
      getSpacePledgedData('mainnet')
    ]);

    const timestamp = new Date().toISOString();

    // Update Google Sheets
    await Promise.all([
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'taurus',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp,
            taurusStats.nodeCount,
            taurusSpacePledged,
            taurusStats.subspaceNodeCount,
            taurusStats.spaceAcresNodeCount,
            taurusStats.linuxNodeCount,
            taurusStats.windowsNodeCount,
            taurusStats.macosNodeCount
          ]]
        },
      }),
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'mainnet',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            timestamp,
            mainnetStats.nodeCount,
            mainnetSpacePledged,
            mainnetStats.subspaceNodeCount,
            mainnetStats.spaceAcresNodeCount,
            mainnetStats.linuxNodeCount,
            mainnetStats.windowsNodeCount,
            mainnetStats.macosNodeCount
          ]]
        },
      })
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Data updated successfully",
        stats: { taurus: taurusStats, mainnet: mainnetStats }
      })
    };

  } catch (error) {
    console.error('Error in handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error processing request",
        error: error.message
      })
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }
};

// Export configuration for Netlify
export const config = {
  schedule: "@hourly"
};